"""Hourly forecasts from Open-Meteo, batched and cached per rounded coordinate.

Coordinates are snapped to a 0.1° grid (~11 km) so nearby checkpoints, the
three route options and the heatmap grid share cache entries and requests.
"""

from __future__ import annotations

import logging
import math
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass

import httpx
from django.conf import settings
from django.core.cache import cache

logger = logging.getLogger(__name__)

GRID_DEG = 0.1
FORECAST_HOURS = 120  # departure ≤ 48 h out + longest US drive time, with margin
# Locations per request. Small batches run several at a time and, more importantly, keep one
# slow response from deciding the whole wall time: a trip used to be one or two large requests
# in series, so a single sluggish one blew the timeout and surfaced as "forecast unavailable".
BATCH_SIZE = 25
MAX_CONCURRENCY = 4
CACHE_TTL_S = 30 * 60
HOURLY_VARS = "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"

# Open-Meteo's latency for the same request varies by a factor of several, so one attempt is not
# evidence the forecast is unavailable. Retry once, with longer to answer and a short pause.
ATTEMPTS = 2
RETRY_BACKOFF_S = 0.4
RETRY_TIMEOUT_FACTOR = 2.0


class WeatherProviderError(Exception):
    """Forecast unavailable. `code` is safe to show the UI."""

    def __init__(self, message: str, code: str = "weather_unavailable"):
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class HourlyForecast:
    """One location's forecast. Arrays are aligned with `start_ts + i * 3600`."""

    start_ts: int
    wind_mph: tuple[float, ...]
    gust_mph: tuple[float, ...]
    rain_in_hr: tuple[float, ...]  # rain + showers
    snow_in_hr: tuple[float, ...]

    def index_at(self, ts: float) -> int | None:
        """Nearest forecast hour for a unix timestamp, or None if out of range."""
        i = math.floor((ts - self.start_ts) / 3600 + 0.5)  # half-up, unlike round()
        return i if 0 <= i < len(self.wind_mph) else None


def snap(lat: float, lon: float, grid_deg: float = GRID_DEG) -> tuple[float, float]:
    return (
        round(round(lat / grid_deg) * grid_deg, 4),
        round(round(lon / grid_deg) * grid_deg, 4),
    )


def _fmt(value: float) -> str:
    return f"{value:.4f}".rstrip("0").rstrip(".")


def _cache_key(point: tuple[float, float]) -> str:
    return f"om:v2:{point[0]:.4f}:{point[1]:.4f}"


def _parse(payload: dict) -> HourlyForecast:
    h = payload["hourly"]

    def nums(key: str) -> tuple[float, ...]:
        # Open-Meteo returns null for missing values; treat as no hazard.
        return tuple(0.0 if v is None else float(v) for v in h[key])

    rain, showers = nums("rain"), nums("showers")
    return HourlyForecast(
        start_ts=int(h["time"][0]),
        wind_mph=nums("wind_speed_10m"),
        gust_mph=nums("wind_gusts_10m"),
        rain_in_hr=tuple(r + s for r, s in zip(rain, showers, strict=True)),
        snow_in_hr=nums("snowfall"),
    )


def _fetch_batch(
    client: httpx.Client, points: list[tuple[float, float]], timeout: float | None = None
) -> list[HourlyForecast]:
    params = {
        "latitude": ",".join(_fmt(p[0]) for p in points),
        "longitude": ",".join(_fmt(p[1]) for p in points),
        "hourly": HOURLY_VARS,
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timeformat": "unixtime",
        "timezone": "GMT",
        "forecast_hours": FORECAST_HOURS,
    }
    try:
        kwargs = {} if timeout is None else {"timeout": timeout}
        response = client.get(settings.OPEN_METEO_URL, params=params, **kwargs)
    except httpx.HTTPError as exc:
        raise WeatherProviderError(f"Open-Meteo request failed: {type(exc).__name__}") from exc
    if response.status_code == 429:
        # Free tier per IP: 600 locations/min, 5k/hour, 10k/day. The body says which one.
        try:
            reason = response.json().get("reason", "")
        except ValueError:
            reason = ""
        logger.warning("Open-Meteo 429 for %d locations: %s", len(points), reason or "no reason")
        raise WeatherProviderError(
            f"Open-Meteo rate limit reached{f': {reason}' if reason else ''}",
            code="weather_rate_limited",
        )
    if response.status_code >= 400:
        raise WeatherProviderError(f"Open-Meteo returned HTTP {response.status_code}")
    data = response.json()
    # A single location comes back as an object, several as a list.
    items = data if isinstance(data, list) else [data]
    if len(items) != len(points):
        raise WeatherProviderError("Open-Meteo returned an unexpected number of locations")
    return [_parse(item) for item in items]


def _fetch_with_retry(
    client: httpx.Client, points: list[tuple[float, float]]
) -> list[HourlyForecast]:
    """One batch, retried once with longer to answer.

    A rate limit is never retried: the budget is per IP and per minute, so a second call would
    only spend more of it and fail the same way. Anything else — a timeout, a dropped
    connection, a 5xx — is treated as the service having a slow moment.
    """
    for attempt in range(ATTEMPTS):
        timeout = settings.PROVIDER_TIMEOUT_S * RETRY_TIMEOUT_FACTOR**attempt
        try:
            return _fetch_batch(client, points, timeout)
        except WeatherProviderError as exc:
            if exc.code == "weather_rate_limited" or attempt == ATTEMPTS - 1:
                raise
            logger.warning(
                "Open-Meteo retrying %d locations after %s (attempt %d of %d)",
                len(points),
                exc,
                attempt + 1,
                ATTEMPTS,
            )
            time.sleep(RETRY_BACKOFF_S)
    raise AssertionError("unreachable")  # pragma: no cover


def get_forecasts(
    coords: list[tuple[float, float]], grid_deg: float = GRID_DEG
) -> dict[tuple[float, float], HourlyForecast]:
    """Forecasts keyed by snapped coordinate. Use `snap(..., grid_deg)` to look results up.

    Every location counts as one Open-Meteo call, so callers should keep `coords` small.
    """
    wanted = list(dict.fromkeys(snap(lat, lon, grid_deg) for lat, lon in coords))
    cached = cache.get_many([_cache_key(p) for p in wanted])
    result = {p: cached[_cache_key(p)] for p in wanted if _cache_key(p) in cached}
    missing = [p for p in wanted if p not in result]
    batches = [missing[i : i + BATCH_SIZE] for i in range(0, len(missing), BATCH_SIZE)]

    def store(batch: list[tuple[float, float]], forecasts: list[HourlyForecast]) -> None:
        fetched = dict(zip(batch, forecasts, strict=True))
        cache.set_many({_cache_key(p): f for p, f in fetched.items()}, CACHE_TTL_S)
        result.update(fetched)

    with httpx.Client(timeout=settings.PROVIDER_TIMEOUT_S) as client:
        if len(batches) == 1:
            store(batches[0], _fetch_with_retry(client, batches[0]))
        elif batches:
            # Batches are independent, so they go out together rather than one after another.
            with ThreadPoolExecutor(max_workers=min(MAX_CONCURRENCY, len(batches))) as pool:
                pending = {pool.submit(_fetch_with_retry, client, b): b for b in batches}
                failure: WeatherProviderError | None = None
                for future in as_completed(pending):
                    try:
                        store(pending[future], future.result())
                    except WeatherProviderError as exc:
                        # Keep going: the batches that did land are worth caching, so a retry
                        # from the UI only has to fetch what is still missing.
                        failure = failure or exc
            if failure:
                raise failure
    return result


def batches_needed(n_points: int) -> int:
    return math.ceil(n_points / BATCH_SIZE)
