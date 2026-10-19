"""Hourly forecasts from Open-Meteo, batched and cached per rounded coordinate.

Coordinates are snapped to a 0.1° grid (~11 km) so nearby checkpoints, the
three route options and the heatmap grid share cache entries and requests.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import httpx
from django.conf import settings
from django.core.cache import cache

GRID_DEG = 0.1
FORECAST_HOURS = 120  # departure ≤ 48 h out + longest US drive time, with margin
BATCH_SIZE = 100  # locations per request; keeps URLs well under server limits
CACHE_TTL_S = 30 * 60
HOURLY_VARS = "wind_speed_10m,wind_gusts_10m,rain,showers,snowfall"


class WeatherProviderError(Exception):
    pass


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


def _fetch_batch(client: httpx.Client, points: list[tuple[float, float]]) -> list[HourlyForecast]:
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
        response = client.get(settings.OPEN_METEO_URL, params=params)
        response.raise_for_status()
    except httpx.HTTPError as exc:
        raise WeatherProviderError(f"Open-Meteo request failed: {exc}") from exc
    data = response.json()
    # A single location comes back as an object, several as a list.
    items = data if isinstance(data, list) else [data]
    if len(items) != len(points):
        raise WeatherProviderError("Open-Meteo returned an unexpected number of locations")
    return [_parse(item) for item in items]


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

    with httpx.Client(timeout=settings.PROVIDER_TIMEOUT_S) as client:
        for i in range(0, len(missing), BATCH_SIZE):
            batch = missing[i : i + BATCH_SIZE]
            fetched = dict(zip(batch, _fetch_batch(client, batch), strict=True))
            cache.set_many({_cache_key(p): f for p, f in fetched.items()}, CACHE_TTL_S)
            result.update(fetched)
    return result


def batches_needed(n_points: int) -> int:
    return math.ceil(n_points / BATCH_SIZE)
