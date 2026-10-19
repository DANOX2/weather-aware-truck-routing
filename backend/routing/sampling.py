"""Place weather checkpoints along a route at a fixed mileage interval.

A checkpoint stands for the stretch of road halfway to each neighbour, so the
miles represented by all checkpoints add up to the route length. That is what
"Severe miles" and "High miles" are measured in.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass

from .geometry import METERS_PER_MILE

ALLOWED_INTERVALS_MI = (10, 25, 50)


@dataclass(frozen=True)
class RouteGeometry:
    """Polyline with cumulative distance and travel time at every vertex."""

    coords: tuple[tuple[float, float], ...]  # (lat, lon)
    cum_distance_m: tuple[float, ...]
    cum_time_s: tuple[float, ...]

    @property
    def length_m(self) -> float:
        return self.cum_distance_m[-1]

    @property
    def duration_s(self) -> float:
        return self.cum_time_s[-1]


@dataclass(frozen=True)
class Checkpoint:
    index: int
    mile: float
    lat: float
    lon: float
    elapsed_s: float  # travel time from departure
    represents_mi: float


def _interpolate(geometry: RouteGeometry, distance_m: float) -> tuple[float, float, float]:
    """(lat, lon, elapsed_s) at a distance along the route."""
    dists = geometry.cum_distance_m
    distance_m = min(max(distance_m, 0.0), dists[-1])
    i = bisect.bisect_right(dists, distance_m) - 1
    if i >= len(dists) - 1:
        lat, lon = geometry.coords[-1]
        return lat, lon, geometry.cum_time_s[-1]
    span = dists[i + 1] - dists[i]
    t = 0.0 if span == 0 else (distance_m - dists[i]) / span
    (lat_a, lon_a), (lat_b, lon_b) = geometry.coords[i], geometry.coords[i + 1]
    time_a, time_b = geometry.cum_time_s[i], geometry.cum_time_s[i + 1]
    return (
        lat_a + (lat_b - lat_a) * t,
        lon_a + (lon_b - lon_a) * t,
        time_a + (time_b - time_a) * t,
    )


def sample_checkpoints(geometry: RouteGeometry, interval_mi: int) -> list[Checkpoint]:
    """Checkpoints at mile 0, every `interval_mi`, and at the destination."""
    if interval_mi not in ALLOWED_INTERVALS_MI:
        raise ValueError(f"interval_mi must be one of {ALLOWED_INTERVALS_MI}")

    total_mi = geometry.length_m / METERS_PER_MILE
    miles = [float(m) for m in range(0, math.ceil(total_mi), interval_mi)]
    # An intermediate checkpoint within a mile of the destination adds nothing; merge it.
    if len(miles) > 1 and total_mi - miles[-1] < 1.0:
        miles.pop()
    if total_mi > 0:
        miles.append(total_mi)

    checkpoints = []
    for i, mile in enumerate(miles):
        start = mile if i == 0 else (miles[i - 1] + mile) / 2
        end = mile if i == len(miles) - 1 else (mile + miles[i + 1]) / 2
        lat, lon, elapsed = _interpolate(geometry, mile * METERS_PER_MILE)
        checkpoints.append(
            Checkpoint(
                index=i,
                mile=round(mile, 2),
                lat=lat,
                lon=lon,
                elapsed_s=elapsed,
                represents_mi=end - start,
            )
        )
    return checkpoints
