from datetime import UTC, datetime, timedelta

import pytest

from routing import services
from routing.providers.open_meteo import HourlyForecast
from routing.tests.test_tomtom import fake_route

HOURS = 120


def forecast(start_ts, gust=5.0, rain=0.0):
    return HourlyForecast(
        start_ts=start_ts,
        wind_mph=(gust,) * HOURS,
        gust_mph=(gust,) * HOURS,
        rain_in_hr=(rain,) * HOURS,
        snow_in_hr=(0.0,) * HOURS,
    )


@pytest.fixture
def depart():
    return datetime.now(UTC).replace(minute=0, second=0, microsecond=0) + timedelta(hours=2)


@pytest.fixture
def providers(monkeypatch, depart):
    """Route 0 is fastest but windy east of lon -96; routes 1 and 2 are calm."""
    routes = [fake_route(0.5, hours=10), fake_route(-1.0, hours=11), fake_route(-2.0, hours=12)]
    monkeypatch.setattr(services.tomtom, "get_routes", lambda *a, **k: routes)

    def get_forecasts(coords):
        start = int(depart.timestamp()) - 3600
        return {
            services.open_meteo.snap(lat, lon): forecast(start, gust=40.0 if lon > -96.5 else 5.0)
            for lat, lon in coords
        }

    monkeypatch.setattr(services.open_meteo, "get_forecasts", get_forecasts)


def test_plan_trip_recommends_safer_route_over_faster(providers, depart):
    trip = services.plan_trip((32.8, -96.8), (39.7, -105.0), depart, 42_000, interval_mi=25)

    rec = trip["recommendation"]
    assert rec["route_id"] == 1
    # 40 mph gusts + 42,000 lb → Severe on route 0; route 2 is as calm but slower.
    assert {b["route_id"]: b["criterion"] for b in rec["beats"]} == {
        0: "severe_miles",
        2: "duration",
    }
    fastest = trip["routes"][0]
    assert fastest["rank"] == 3
    assert fastest["miles_by_level"]["SEVERE"] > 0

    cp = fastest["checkpoints"][1]
    assert cp["level"] == "SEVERE"
    assert cp["drivers"] == ["wind"]
    assert cp["load_escalated"] is True


def test_route_payload_is_map_ready(providers, depart):
    trip = services.plan_trip((32.8, -96.8), (39.7, -105.0), depart, 10_000, interval_mi=50)
    route = trip["routes"][1]
    lon, lat = route["path"][0]
    assert -110 < lon < -90 and 30 < lat < 45  # GeoJSON [lon, lat]
    assert sum(cp["represents_mi"] for cp in route["checkpoints"]) == pytest.approx(
        route["distance_mi"], abs=0.5
    )
    assert {r["rank"] for r in trip["routes"]} == {1, 2, 3}
