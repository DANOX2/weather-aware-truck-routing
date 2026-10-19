"""Risk heatmap along the trip corridor, 0–48 h from now.

Open-Meteo counts every location as one call (10k/day, 600/min per IP), so we
only fetch grid cells near the routes, and pick the cell size so a trip never
needs more than MAX_CELLS locations. Values are a continuous risk index
(see `risk_index`) packed as one byte per cell per hour.
"""

from __future__ import annotations

import base64
import math
import time

from django.conf import settings

from .geometry import LatLon
from .providers import open_meteo
from .risk import (
    RAIN_IN_HR,
    RAIN_NO_TRAVEL_IN_HR,
    SNOW_IN_HR,
    SNOW_NO_TRAVEL_IN_HR,
    WIND_MPH,
    WIND_NO_TRAVEL_MPH,
    RiskLevel,
    assess,
)

HOURS = 49  # 0..48 inclusive
MAX_CELLS = 300
CELL_SIZES_DEG = (0.25, 0.5, 0.75, 1.0)
CORRIDOR_CELLS = 1  # include neighbours this many cells away from a route cell
INDEX_SCALE = 50  # byte = round(index * 50); index 0.0–4.0 → 0–200


def _band_fraction(value: float, bounds: tuple[float, float, float], ceiling: float) -> float:
    """Position of `value` inside its band, 0.0–0.99, for a smooth gradient between levels."""
    edges = (0.0, *bounds, ceiling)
    for lo, hi in zip(edges, edges[1:], strict=False):
        if value < hi:
            return min(max((value - lo) / (hi - lo), 0.0), 0.99)
    return 0.0


def risk_index(wind_mph: float, rain_in_hr: float, snow_in_hr: float, weight_lb: float) -> float:
    """Continuous 0.0–4.0 score whose integer part is always the checkpoint RiskLevel."""
    result = assess(wind_mph, rain_in_hr, snow_in_hr, weight_lb)
    if result.level == RiskLevel.NO_TRAVEL:
        return float(RiskLevel.NO_TRAVEL)
    fractions = []
    if result.wind == result.level:
        # A load-escalated wind sits in a band it didn't reach on its own: use mid-band.
        fractions.append(
            0.5 if result.load_escalated else _band_fraction(wind_mph, WIND_MPH, WIND_NO_TRAVEL_MPH)
        )
    if result.rain == result.level:
        fractions.append(_band_fraction(rain_in_hr, RAIN_IN_HR, RAIN_NO_TRAVEL_IN_HR))
    if result.snow == result.level:
        fractions.append(_band_fraction(snow_in_hr, SNOW_IN_HR, SNOW_NO_TRAVEL_IN_HR))
    return result.level + (max(fractions) if fractions else 0.0)


def corridor_cells(paths: list[list[LatLon]]) -> tuple[float, set[tuple[int, int]]]:
    """Smallest cell size whose corridor fits MAX_CELLS, and the (row, col) cells in it."""
    for size in CELL_SIZES_DEG:
        cells: set[tuple[int, int]] = set()
        for path in paths:
            for lat, lon in path:
                # Cell (r, c) is centred on (r * size, c * size), matching open_meteo.snap().
                r, c = round(lat / size), round(lon / size)
                for dr in range(-CORRIDOR_CELLS, CORRIDOR_CELLS + 1):
                    for dc in range(-CORRIDOR_CELLS, CORRIDOR_CELLS + 1):
                        cells.add((r + dr, c + dc))
        if len(cells) <= MAX_CELLS:
            return size, cells
    return size, set(sorted(cells)[:MAX_CELLS])


def _densify(path: list[LatLon], step_deg: float) -> list[LatLon]:
    """Add points so consecutive vertices are never more than `step_deg` apart."""
    out = [path[0]]
    for (lat1, lon1), (lat2, lon2) in zip(path, path[1:], strict=False):
        n = max(1, math.ceil(max(abs(lat2 - lat1), abs(lon2 - lon1)) / step_deg))
        out.extend(
            (lat1 + (lat2 - lat1) * i / n, lon1 + (lon2 - lon1) * i / n) for i in range(1, n + 1)
        )
    return out


def build_heatmap(paths: list[list[LatLon]], weight_lb: float) -> dict:
    paths = [_densify(p, CELL_SIZES_DEG[0] / 2) for p in paths if p]
    size, cells = corridor_cells(paths)
    rows = [r for r, _ in cells]
    cols = [c for _, c in cells]
    row0, col0 = min(rows), min(cols)
    nx, ny = max(cols) - col0 + 1, max(rows) - row0 + 1

    ordered = sorted(cells)
    centers = [(r * size, c * size) for r, c in ordered]
    forecasts = open_meteo.get_forecasts(centers, grid_deg=size)
    gusts = settings.WIND_METRIC == "gust"

    now_hour = int(time.time() // 3600 * 3600)
    values = bytearray(HOURS * len(ordered))
    for j, center in enumerate(centers):
        f = forecasts[open_meteo.snap(*center, grid_deg=size)]
        for h in range(HOURS):
            i = f.index_at(now_hour + h * 3600)
            if i is None:
                continue
            wind = f.gust_mph[i] if gusts else f.wind_mph[i]
            score = risk_index(wind, f.rain_in_hr[i], f.snow_in_hr[i], weight_lb)
            values[h * len(ordered) + j] = round(score * INDEX_SCALE)

    return {
        "grid": {
            "cell_deg": size,
            "lat0": (row0 - 0.5) * size,  # south edge of the grid
            "lon0": (col0 - 0.5) * size,  # west edge of the grid
            "nx": nx,
            "ny": ny,
        },
        # Cell positions inside the nx × ny grid, row-major from the south-west corner.
        "cells": [(r - row0) * nx + (c - col0) for r, c in ordered],
        "start": now_hour,
        "hours": HOURS,
        "index_scale": INDEX_SCALE,
        # values[h * len(cells) + k] = risk index × index_scale for cell k at start + h hours
        "values": base64.b64encode(bytes(values)).decode(),
    }
