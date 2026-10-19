from datetime import UTC, datetime, timedelta

import pytest

from routing import views
from routing.providers.open_meteo import WeatherProviderError
from routing.providers.tomtom import Place, RoutingProviderError

DALLAS = {"lat": 32.7767, "lon": -96.797, "label": "Dallas, TX"}
DENVER = {"lat": 39.7392, "lon": -104.9903, "label": "Denver, CO"}


def trip_body(**overrides):
    body = {
        "origin": DALLAS,
        "destination": DENVER,
        "depart_at": (datetime.now(UTC) + timedelta(hours=2)).isoformat(),
        "weight_lb": 42_000,
        "interval_mi": 25,
    }
    return body | overrides


@pytest.fixture
def plan(monkeypatch):
    calls = []

    def fake_plan(**kwargs):
        calls.append(kwargs)
        return {"routes": [], "recommendation": {}}

    monkeypatch.setattr(views.services, "plan_trip", fake_plan)
    return calls


def post(client, url, body):
    return client.post(url, body, content_type="application/json")


def test_trip_happy_path(client, plan):
    response = post(client, "/api/trips/", trip_body())
    assert response.status_code == 200
    assert plan[0]["origin"] == (DALLAS["lat"], DALLAS["lon"])
    assert plan[0]["interval_mi"] == 25


@pytest.mark.parametrize(
    ("overrides", "field"),
    [
        ({"depart_at": (datetime.now(UTC) - timedelta(hours=1)).isoformat()}, "depart_at"),
        ({"depart_at": (datetime.now(UTC) + timedelta(hours=49)).isoformat()}, "depart_at"),
        ({"weight_lb": 90_000}, "weight_lb"),
        ({"weight_lb": 500}, "weight_lb"),
        ({"interval_mi": 15}, "interval_mi"),
        ({"destination": DALLAS}, "non_field_errors"),
    ],
)
def test_trip_validation(client, plan, overrides, field):
    response = post(client, "/api/trips/", trip_body(**overrides))
    assert response.status_code == 400
    assert field in response.json()
    assert plan == []


def test_departure_a_few_minutes_ago_counts_as_now(client, plan):
    five_min_ago = (datetime.now(UTC) - timedelta(minutes=5)).isoformat()
    assert post(client, "/api/trips/", trip_body(depart_at=five_min_ago)).status_code == 200
    assert plan[0]["depart_at"] >= datetime.now(UTC) - timedelta(seconds=5)


@pytest.mark.parametrize(
    ("error", "http", "code"),
    [
        (RoutingProviderError("x", code="no_route"), 422, "no_route"),
        (RoutingProviderError("x", code="rate_limited"), 503, "rate_limited"),
        (RoutingProviderError("x"), 502, "routing_unavailable"),
        (WeatherProviderError("x"), 502, "weather_unavailable"),
    ],
)
def test_provider_errors_map_to_stable_codes(client, monkeypatch, error, http, code):
    def boom(**kwargs):
        raise error

    monkeypatch.setattr(views.services, "plan_trip", boom)
    response = post(client, "/api/trips/", trip_body())
    assert response.status_code == http
    assert response.json()["code"] == code


def test_geocode_ignores_short_queries(client, monkeypatch):
    monkeypatch.setattr(views, "search_places", lambda q: pytest.fail("should not call"))
    assert client.get("/api/geocode/?q=da").json() == {"results": []}


def test_geocode_returns_places(client, monkeypatch):
    monkeypatch.setattr(views, "search_places", lambda q: [Place("Dallas, TX", 32.78, -96.8)])
    assert client.get("/api/geocode/?q=dallas").json() == {
        "results": [{"label": "Dallas, TX", "lat": 32.78, "lon": -96.8}]
    }


def test_heatmap_converts_lonlat_paths(client, monkeypatch):
    seen = {}

    def fake_build(paths, weight_lb):
        seen["paths"] = paths
        return {"ok": True}

    monkeypatch.setattr(views, "build_heatmap", fake_build)
    response = post(
        client, "/api/heatmap/", {"paths": [[[-96.8, 32.8], [-97.0, 33.0]]], "weight_lb": 30_000}
    )
    assert response.status_code == 200
    assert seen["paths"] == [[(32.8, -96.8), (33.0, -97.0)]]


def test_heatmap_rejects_too_many_paths(client):
    body = {"paths": [[[0, 0], [1, 1]]] * 6, "weight_lb": 30_000}
    assert post(client, "/api/heatmap/", body).status_code == 400


def test_demo_mode_replays_recorded_trip_without_providers(client, settings, monkeypatch):
    settings.DEMO_FIXTURES = True
    monkeypatch.setattr(views.services, "plan_trip", lambda **k: pytest.fail("no providers"))
    depart = datetime.now(UTC).replace(second=0, microsecond=0) + timedelta(hours=3)
    trip = post(client, "/api/trips/", trip_body(depart_at=depart.isoformat())).json()
    assert trip["demo"] is True
    assert datetime.fromisoformat(trip["routes"][0]["departure"]) == depart
    assert len(trip["routes"]) == 3
    heat = post(client, "/api/heatmap/", {"paths": [[[0, 0], [1, 1]]], "weight_lb": 30_000}).json()
    assert heat["demo"] is True
