from datetime import UTC, datetime

import httpx
import pytest
import respx
from django.core.cache import cache

from routing.providers import tomtom
from routing.providers.tomtom import (
    Route,
    RoutingProviderError,
    _parse_route,
    detour_points,
    get_routes,
    search_places,
    select_routes,
    via_radius_m,
)
from routing.sampling import RouteGeometry

DALLAS, DENVER = (32.7767, -96.7970), (39.7392, -104.9903)
ROUTING = respx.route(host="api.tomtom.com", path__startswith="/routing/")


@pytest.fixture(autouse=True)
def setup(settings):
    settings.TOMTOM_API_KEY = "test-key"
    cache.clear()


def raw_route(lon_offset=0.0, hours=10.0, n=50, progress=True):
    """Straight north-south line from Dallas latitude, shifted east by `lon_offset` degrees."""
    pts = [
        {"latitude": DALLAS[0] + i * 0.14, "longitude": DALLAS[1] + lon_offset} for i in range(n)
    ]
    route = {
        "summary": {"lengthInMeters": 1_000_000, "travelTimeInSeconds": hours * 3600},
        "legs": [{"points": pts}],
    }
    if progress:
        # Sparse, like the real API: first, middle, last.
        route["progress"] = [
            {"pointIndex": 0, "travelTimeInSeconds": 0},
            {"pointIndex": n // 2, "travelTimeInSeconds": hours * 3600 * 0.7},  # slow first half
            {"pointIndex": n - 1, "travelTimeInSeconds": hours * 3600},
        ]
    return route


def fake_route(lon_offset=0.0, hours=10.0) -> Route:
    return _parse_route(raw_route(lon_offset, hours))


def test_parse_joins_legs_and_scales_to_official_length():
    raw = raw_route()
    pts = raw["legs"][0]["points"]
    raw["legs"] = [{"points": pts[:20]}, {"points": pts[19:]}]  # shared joining point
    route = _parse_route(raw)
    assert len(route.geometry.coords) == len(pts)
    assert route.geometry.length_m == pytest.approx(1_000_000)


def test_eta_interpolated_between_sparse_progress_anchors():
    route = fake_route(hours=10)
    times = route.geometry.cum_time_s
    assert times[0] == 0
    assert times[25] == pytest.approx(7 * 3600)
    assert times[-1] == pytest.approx(10 * 3600)
    assert times[12] == pytest.approx(7 * 3600 * 12 / 25, rel=0.01)  # constant speed within span


def test_eta_without_progress_assumes_constant_speed():
    route = _parse_route(raw_route(progress=False, hours=10))
    assert route.geometry.cum_time_s[-1] == pytest.approx(10 * 3600)


def test_select_drops_duplicates_and_slow_outliers():
    routes = [
        fake_route(0.0, 10),
        fake_route(0.01, 10.2),  # same corridor → duplicate
        fake_route(2.0, 16),  # > 1.5× fastest → outlier
        fake_route(1.0, 11),
        fake_route(-1.0, 12),
    ]
    chosen = select_routes(routes)
    assert [r.duration_s / 3600 for r in chosen] == [10, 11, 12]


def test_detour_points_sit_either_side_of_midpoint():
    east, west = detour_points((30.0, -100.0), (40.0, -100.0), 0.15)  # due north trip
    assert east[0] == pytest.approx(35.0) and west[0] == pytest.approx(35.0)
    assert east[1] > -100.0 > west[1]
    assert detour_points((30.0, -100.0), (40.0, -100.0), 0.30)[0][1] > east[1]


def _points(request) -> list[tuple[float, float]]:
    """Stops as (lat, lon); circle waypoints keep only their centre."""
    locations = request.url.path.split("/calculateRoute/")[1].removesuffix("/json")
    return [
        tuple(map(float, p.removeprefix("circle(").removesuffix(")").split(",")[:2]))
        for p in locations.split(":")
    ]


def corridor_by_via(fail_vias=(), hours=11.0, alternatives=()):
    """Main route on the straight corridor; each detour follows its via-point's longitude.

    `alternatives`: (lon_offset, hours) of the routes TomTom adds when asked for alternatives.
    """
    failing = {(round(lat, 5), round(lon, 5)) for lat, lon in fail_vias}

    def handler(request):
        points = _points(request)
        if "maxAlternatives" in request.url.params:
            extra = [raw_route(offset, hours=h) for offset, h in alternatives]
            return httpx.Response(200, json={"routes": [raw_route(0, hours=10), *extra]})
        if len(points) == 2:
            return httpx.Response(200, json={"routes": [raw_route(0, hours=10)]})
        if points[1] in failing:
            return httpx.Response(500)
        via_lon_offset = points[1][1] - DALLAS[1]
        return httpx.Response(200, json={"routes": [raw_route(via_lon_offset, hours=hours)]})

    return handler


@respx.mock
def test_detours_cross_a_circle_instead_of_an_exact_point():
    ROUTING.mock(side_effect=corridor_by_via())
    get_routes(DALLAS, DENVER, None, 40_000)
    detour_path = ROUTING.calls[1].request.url.path
    assert detour_path.count("circle(") == 1  # only the via; origin and destination stay exact
    radius = float(detour_path.split("circle(")[1].split(")")[0].split(",")[2])
    assert radius == round(via_radius_m(DALLAS, DENVER, 0.15))
    assert 5_000 <= radius <= 50_000


@respx.mock
def test_first_wave_is_main_plus_two_detours_in_parallel():
    ROUTING.mock(side_effect=corridor_by_via())
    routes = get_routes(DALLAS, DENVER, None, 40_000)
    assert len(routes) == 3
    assert ROUTING.call_count == 3
    assert [r.via_detour for r in routes] == [False, True, True]
    params = ROUTING.calls[0].request.url.params
    assert params["travelMode"] == "truck"
    assert params["vehicleWeight"] == "18144"  # 40,000 lb in kg
    assert "maxAlternatives" not in params  # adds ~5.5 s on long trips


@respx.mock
def test_second_wave_only_when_first_falls_short():
    ROUTING.mock(side_effect=corridor_by_via(fail_vias=detour_points(DALLAS, DENVER, 0.15)))
    routes = get_routes(DALLAS, DENVER, None, 40_000)
    assert len(routes) == 3
    assert ROUTING.call_count == 5


@respx.mock
def test_slow_detours_are_dropped():
    ROUTING.mock(side_effect=corridor_by_via(hours=21))  # > 2× the 10 h main route
    routes = get_routes(DALLAS, DENVER, None, 40_000)
    assert [r.via_detour for r in routes] == [False]
    assert ROUTING.call_count == 6  # 2 detour waves + one alternatives request


@respx.mock
def test_short_list_asks_tomtom_for_alternatives_then_relaxes():
    # Detours at 16 h (1.6×) miss the strict 1.5× limit; TomTom offers one more corridor.
    ROUTING.mock(side_effect=corridor_by_via(hours=16, alternatives=[(0.5, 12)]))
    routes = get_routes(DALLAS, DENVER, None, 40_000)
    assert [r.duration_s / 3600 for r in routes] == [10, 12, 16]
    assert [r.via_detour for r in routes] == [False, False, True]
    assert ROUTING.calls[-1].request.url.params["maxAlternatives"] == "2"


def test_relaxed_selection_prefers_strict_routes_and_still_drops_copies():
    routes = [
        fake_route(0.0, 10),
        fake_route(1.0, 17),  # only passes the relaxed 2× limit
        fake_route(0.002, 10.1),  # same cells as the main route → copy, even when relaxed
        fake_route(-1.0, 12),
    ]
    assert [r.duration_s / 3600 for r in select_routes(routes)] == [10, 12]
    assert [r.duration_s / 3600 for r in select_routes(routes, relaxed=True)] == [10, 12, 17]


@respx.mock
def test_main_route_failure_is_an_error():
    ROUTING.mock(return_value=httpx.Response(500))
    with pytest.raises(RoutingProviderError):
        get_routes(DALLAS, DENVER, None, 40_000)


@respx.mock
def test_routes_are_cached_per_15_minute_slot():
    ROUTING.mock(side_effect=corridor_by_via())
    get_routes(DALLAS, DENVER, datetime(2026, 10, 20, 8, 1, tzinfo=UTC), 40_000)
    get_routes(DALLAS, DENVER, datetime(2026, 10, 20, 8, 14, tzinfo=UTC), 40_200)
    assert ROUTING.call_count == 3
    assert ROUTING.calls[0].request.url.params["departAt"] == "2026-10-20T08:01:00+00:00"


@respx.mock
def test_no_route_error_has_ui_code():
    ROUTING.mock(return_value=httpx.Response(400, text='{"error":"NO_ROUTE_FOUND"}'))
    with pytest.raises(RoutingProviderError) as exc:
        get_routes(DALLAS, DENVER, None, 40_000)
    assert exc.value.code == "no_route"


@respx.mock
def test_error_message_never_leaks_api_key():
    ROUTING.mock(return_value=httpx.Response(403, text="bad key test-key"))
    with pytest.raises(RoutingProviderError) as exc:
        get_routes(DALLAS, DENVER, None, 40_000)
    assert "test-key" not in str(exc.value)


def test_missing_key_is_reported(settings):
    settings.TOMTOM_API_KEY = ""
    with pytest.raises(RoutingProviderError) as exc:
        get_routes(DALLAS, DENVER, None, 40_000)
    assert exc.value.code == "not_configured"


@respx.mock
def test_search_encodes_query_and_caches():
    route = respx.get(url__regex=r"https://api\.tomtom\.com/search/2/search/.+\.json").mock(
        return_value=httpx.Response(
            200,
            json={
                "results": [
                    {
                        "address": {"freeformAddress": "Dallas, TX"},
                        "position": {"lat": 32.78, "lon": -96.8},
                    }
                ]
            },
        )
    )
    places = search_places("Dallas, TX")
    search_places("  dallas,   tx ")
    assert places[0].label == "Dallas, TX"
    assert route.call_count == 1
    assert "Dallas%2C%20TX" in str(route.calls[0].request.url)


def test_geometry_type_is_shared_with_sampling():
    assert isinstance(fake_route().geometry, RouteGeometry)
    assert tomtom.ROUTES_WANTED == 3
