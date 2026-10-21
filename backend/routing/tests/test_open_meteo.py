import time

import httpx
import pytest
import respx
from django.core.cache import cache

from routing.providers import open_meteo
from routing.providers.open_meteo import WeatherProviderError, get_forecasts, snap

URL = "https://api.open-meteo.com/v1/forecast"


def _location(start=1_760_000_400, hours=3, gust=30.0, rain=0.1, showers=0.05, snow=0.0):
    return {
        "hourly": {
            "time": [start + i * 3600 for i in range(hours)],
            "wind_speed_10m": [20.0] * hours,
            "wind_gusts_10m": [gust] * hours,
            "rain": [rain] * hours,
            "showers": [showers] * hours,
            "snowfall": [snow] * (hours - 1) + [None],
        }
    }


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()


@respx.mock
def test_rain_includes_showers_and_nulls_become_zero():
    respx.get(URL).mock(return_value=httpx.Response(200, json=_location()))
    forecast = get_forecasts([(39.74, -104.99)])[snap(39.74, -104.99)]
    assert forecast.rain_in_hr[0] == pytest.approx(0.15)
    assert forecast.snow_in_hr[-1] == 0.0


@respx.mock
def test_nearby_points_share_one_location_and_cache():
    route = respx.get(URL).mock(return_value=httpx.Response(200, json=_location()))
    # Both snap to (39.7, -105.0)
    get_forecasts([(39.71, -104.99), (39.74, -105.03)])
    assert route.call_count == 1
    assert route.calls[0].request.url.params["latitude"] == "39.7"

    get_forecasts([(39.72, -105.01)])
    assert route.call_count == 1  # served from cache


@respx.mock
def test_requests_are_batched(monkeypatch):
    monkeypatch.setattr(open_meteo, "BATCH_SIZE", 2)
    route = respx.get(URL).mock(
        side_effect=lambda request: httpx.Response(
            200,
            json=[_location()] * len(request.url.params["latitude"].split(",")),
        )
    )
    result = get_forecasts([(30.0, -90.0), (31.0, -90.0), (32.0, -90.0)])
    assert route.call_count == 2
    assert len(result) == 3


@respx.mock
def test_provider_failure_raises_domain_error():
    respx.get(URL).mock(return_value=httpx.Response(503))
    with pytest.raises(WeatherProviderError):
        get_forecasts([(30.0, -90.0)])


@respx.mock
def test_a_slow_moment_is_retried_before_giving_up(monkeypatch):
    monkeypatch.setattr(open_meteo, "RETRY_BACKOFF_S", 0)
    route = respx.get(URL).mock(
        side_effect=[httpx.Response(503), httpx.Response(200, json=_location())]
    )
    forecast = get_forecasts([(30.0, -90.0)])[snap(30.0, -90.0)]
    assert route.call_count == 2
    assert forecast.gust_mph[0] == 30.0


@respx.mock
def test_the_retry_allows_longer_to_answer(monkeypatch):
    monkeypatch.setattr(open_meteo, "RETRY_BACKOFF_S", 0)
    timeouts = []

    def record(request):
        timeouts.append(request.extensions["timeout"]["read"])
        return httpx.Response(503) if len(timeouts) == 1 else httpx.Response(200, json=_location())

    respx.get(URL).mock(side_effect=record)
    get_forecasts([(30.0, -90.0)])
    assert timeouts[1] > timeouts[0]


@respx.mock
def test_a_rate_limit_is_not_retried(monkeypatch):
    # The budget is per IP and per minute, so a second call only spends more of it.
    monkeypatch.setattr(open_meteo, "RETRY_BACKOFF_S", 0)
    route = respx.get(URL).mock(return_value=httpx.Response(429, json={"reason": "minutely"}))
    with pytest.raises(WeatherProviderError) as err:
        get_forecasts([(30.0, -90.0)])
    assert err.value.code == "weather_rate_limited"
    assert route.call_count == 1


@respx.mock
def test_batches_overlap_instead_of_running_in_series(monkeypatch):
    monkeypatch.setattr(open_meteo, "BATCH_SIZE", 1)
    delay = 0.25

    def slow(request):
        time.sleep(delay)
        return httpx.Response(200, json=_location())

    respx.get(URL).mock(side_effect=slow)
    started = time.monotonic()
    result = get_forecasts([(30.0, -90.0), (31.0, -90.0), (32.0, -90.0), (33.0, -90.0)])
    elapsed = time.monotonic() - started
    assert len(result) == 4
    # In series this is four delays; overlapped it is about one.
    assert elapsed < delay * 2.5


@respx.mock
def test_a_failed_batch_still_caches_the_ones_that_landed(monkeypatch):
    monkeypatch.setattr(open_meteo, "BATCH_SIZE", 1)
    monkeypatch.setattr(open_meteo, "RETRY_BACKOFF_S", 0)

    def by_latitude(request):
        bad = request.url.params["latitude"] == "31"
        return httpx.Response(503) if bad else httpx.Response(200, json=_location())

    respx.get(URL).mock(side_effect=by_latitude)
    with pytest.raises(WeatherProviderError):
        get_forecasts([(30.0, -90.0), (31.0, -90.0)])
    # Retrying from the UI should only have to fetch what is still missing.
    assert cache.get(open_meteo._cache_key(snap(30.0, -90.0))) is not None


def test_index_at_picks_nearest_hour():
    forecast = open_meteo._parse(_location(start=0, hours=3))
    assert forecast.index_at(0) == 0
    assert forecast.index_at(1799) == 0
    assert forecast.index_at(1800) == 1  # half-up
    assert forecast.index_at(5400) == 2
    assert forecast.index_at(3 * 3600) is None
    assert forecast.index_at(-3600) is None


@respx.mock
def test_rate_limit_has_its_own_code():
    respx.get(URL).mock(return_value=httpx.Response(429))
    with pytest.raises(WeatherProviderError) as exc:
        get_forecasts([(30.0, -90.0)])
    assert exc.value.code == "weather_rate_limited"


@respx.mock
def test_rate_limit_says_which_limit():
    reason = "Hourly API request limit exceeded. Please try again in the next hour."
    respx.get(URL).mock(return_value=httpx.Response(429, json={"error": True, "reason": reason}))
    with pytest.raises(WeatherProviderError, match="Hourly API request limit"):
        get_forecasts([(30.0, -90.0)])
