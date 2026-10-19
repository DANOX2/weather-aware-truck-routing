import httpx
import pytest
import respx
from django.core.cache import cache

from routing.providers.tomtom import RoutingProviderError
from routing.providers.valhalla import decode_polyline, get_routes

URL = "https://valhalla1.openstreetmap.de/route"
DALLAS, DENVER = (32.7767, -96.797), (39.7392, -104.9903)


@pytest.fixture(autouse=True)
def clear_cache():
    cache.clear()


def encode(coords, precision=6):
    out, prev = [], (0, 0)
    for lat, lon in coords:
        point = (round(lat * 10**precision), round(lon * 10**precision))
        for value in (point[0] - prev[0], point[1] - prev[1]):
            value = ~(value << 1) if value < 0 else value << 1
            while value >= 0x20:
                out.append(chr((0x20 | (value & 0x1F)) + 63))
                value >>= 5
            out.append(chr(value + 63))
        prev = point
    return "".join(out)


def trip(lon_offset=0.0, hours=12.0):
    pts = [(DALLAS[0] + i * 0.14, DALLAS[1] + lon_offset) for i in range(50)]
    return {
        "summary": {"length": 1400.0, "time": hours * 3600},
        "legs": [
            {
                "shape": encode(pts),
                "maneuvers": [
                    {"begin_shape_index": 0, "time": hours * 3600 * 0.6},
                    {"begin_shape_index": 25, "time": hours * 3600 * 0.4},
                ],
            }
        ],
    }


def test_decode_matches_google_reference_example():
    coords = decode_polyline("_p~iF~ps|U_ulLnnqC_mqNvxq`@", precision=5)
    assert coords == pytest.approx([(38.5, -120.2), (40.7, -120.95), (43.252, -126.453)])


@respx.mock
def test_routes_with_alternates_and_maneuver_eta_anchors():
    route = respx.post(URL).mock(
        return_value=httpx.Response(
            200, json={"trip": trip(0), "alternates": [{"trip": trip(1.0, 13)}]}
        )
    )
    routes = get_routes(DALLAS, DENVER, 40_000)
    assert len(routes) == 2
    assert routes[0].distance_m == pytest.approx(1_400_000)
    assert routes[0].geometry.cum_time_s[25] == pytest.approx(12 * 3600 * 0.6)
    body = route.calls[0].request.read().decode()
    assert '"costing":"truck"' in body.replace(" ", "")
    assert '"weight":18.14' in body.replace(" ", "")  # metric tons


@respx.mock
def test_errors_become_routing_provider_errors():
    respx.post(URL).mock(return_value=httpx.Response(429))
    with pytest.raises(RoutingProviderError) as exc:
        get_routes(DALLAS, DENVER, 40_000)
    assert exc.value.code == "rate_limited"
