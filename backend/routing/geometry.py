"""Small geodesy helpers shared by sampling, providers and the heatmap."""

from __future__ import annotations

import math

METERS_PER_MILE = 1609.344
EARTH_RADIUS_M = 6_371_008.8

LatLon = tuple[float, float]


def haversine_m(a: tuple[float, float], b: tuple[float, float]) -> float:
    lat1, lon1, lat2, lon2 = map(math.radians, (*a, *b))
    h = (
        math.sin((lat2 - lat1) / 2) ** 2
        + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    )
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(h))


def cumulative_distances(coords: list[tuple[float, float]]) -> list[float]:
    out = [0.0]
    for a, b in zip(coords, coords[1:], strict=False):
        out.append(out[-1] + haversine_m(a, b))
    return out


def simplify(coords: list[LatLon], tolerance_deg: float) -> list[LatLon]:
    """Ramer–Douglas–Peucker in lat/lon space; keeps both endpoints."""
    if len(coords) < 3:
        return list(coords)
    keep = [False] * len(coords)
    keep[0] = keep[-1] = True
    stack = [(0, len(coords) - 1)]
    while stack:
        first, last = stack.pop()
        (y1, x1), (y2, x2) = coords[first], coords[last]
        dy, dx = y2 - y1, x2 - x1
        norm = math.hypot(dx, dy)
        best, best_i = 0.0, -1
        for i in range(first + 1, last):
            y, x = coords[i]
            if norm == 0:
                dist = math.hypot(x - x1, y - y1)
            else:
                dist = abs(dy * (x - x1) - dx * (y - y1)) / norm
            if dist > best:
                best, best_i = dist, i
        if best > tolerance_deg:
            keep[best_i] = True
            stack.extend(((first, best_i), (best_i, last)))
    return [c for c, k in zip(coords, keep, strict=True) if k]
