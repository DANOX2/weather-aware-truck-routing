"""Fallback truck routing via the public Valhalla server (OpenStreetMap data, no key).

Used only when TomTom fails or is rate limited. The FOSSGIS server is a
fair-use service without guarantees and without live traffic, which is why it
is the backup rather than the primary provider.
"""

from __future__ import annotations

import httpx
from django.conf import settings
from django.core.cache import cache

from ..geometry import LatLon, cumulative_distances
from ..sampling import RouteGeometry
from .tomtom import KG_PER_LB, ROUTE_CACHE_TTL_S, Route, RoutingProviderError, interpolate_times
from .tomtom import select_routes as select_distinct

USER_AGENT = "weather-aware-truck-routing (assessment project)"


def decode_polyline(encoded: str, precision: int = 6) -> list[LatLon]:
    """Google encoded polyline; Valhalla uses 6 decimal places."""
    coords, index, lat, lon = [], 0, 0, 0
    factor = 10**precision
    while index < len(encoded):
        for axis in (0, 1):
            shift = result = 0
            while True:
                byte = ord(encoded[index]) - 63
                index += 1
                result |= (byte & 0x1F) << shift
                shift += 5
                if byte < 0x20:
                    break
            delta = ~(result >> 1) if result & 1 else result >> 1
            if axis == 0:
                lat += delta
            else:
                lon += delta
        coords.append((lat / factor, lon / factor))
    return coords


def _parse_trip(trip: dict) -> Route:
    leg = trip["legs"][0]
    coords = decode_polyline(leg["shape"])
    length_m = float(trip["summary"]["length"]) * 1000  # requested in kilometers
    duration_s = float(trip["summary"]["time"])

    dists = cumulative_distances(coords)
    scale = length_m / dists[-1] if dists[-1] else 1.0
    dists = [d * scale for d in dists]

    # Each maneuver starts at a shape index; their cumulative times are our ETA anchors.
    progress, elapsed = [], 0.0
    for maneuver in leg.get("maneuvers", []):
        progress.append(
            {"pointIndex": maneuver["begin_shape_index"], "travelTimeInSeconds": elapsed}
        )
        elapsed += float(maneuver.get("time", 0))
    times = interpolate_times(dists, progress, duration_s)

    return Route(
        geometry=RouteGeometry(tuple(coords), tuple(dists), tuple(times)),
        distance_m=length_m,
        duration_s=duration_s,
        traffic_delay_s=0.0,
        via_detour=False,
    )


def get_routes(origin: LatLon, destination: LatLon, weight_lb: float) -> list[Route]:
    key = "vh:routes:v1:{:.5f},{:.5f}:{:.5f},{:.5f}:{}".format(
        *origin, *destination, round(weight_lb / 1000)
    )
    if (hit := cache.get(key)) is not None:
        return hit

    body = {
        "locations": [
            {"lat": origin[0], "lon": origin[1]},
            {"lat": destination[0], "lon": destination[1]},
        ],
        "costing": "truck",
        "costing_options": {"truck": {"weight": round(weight_lb * KG_PER_LB / 1000, 2)}},  # t
        "alternates": 2,
        "units": "kilometers",
        "directions_type": "maneuvers",
    }
    try:
        response = httpx.post(
            settings.VALHALLA_URL,
            json=body,
            headers={"User-Agent": USER_AGENT},
            timeout=settings.PROVIDER_TIMEOUT_S,
        )
    except httpx.HTTPError as exc:
        raise RoutingProviderError(f"Valhalla request failed: {type(exc).__name__}") from exc
    if response.status_code == 400:
        raise RoutingProviderError("No truck route between these points", code="no_route")
    if response.status_code == 429:
        raise RoutingProviderError("Valhalla rate limit reached", code="rate_limited")
    if response.status_code >= 400:
        raise RoutingProviderError(f"Valhalla returned HTTP {response.status_code}")

    data = response.json()
    trips = [data["trip"], *(alt["trip"] for alt in data.get("alternates", []))]
    routes = select_distinct([_parse_trip(t) for t in trips])
    if not routes:
        raise RoutingProviderError("No truck route between these points", code="no_route")
    cache.set(key, routes, ROUTE_CACHE_TTL_S)
    return routes
