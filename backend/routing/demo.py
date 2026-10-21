"""Demo mode: replay a recorded real trip so UI work costs no provider quota.

Enabled with DEMO_FIXTURES=1. Timestamps are shifted so the recording looks
current: the trip departs when requested, the heatmap starts this hour.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timedelta
from functools import cache
from pathlib import Path

FIXTURES = Path(__file__).parent / "fixtures"
TRIP_TIME_FIELDS = ("departure", "arrival")


@cache
def _load(name: str) -> dict:
    return json.loads((FIXTURES / name).read_text())


def _shift(value: str | None, delta: timedelta) -> str | None:
    if value is None:
        return None
    return (datetime.fromisoformat(value) + delta).isoformat(timespec="minutes")


def trip(depart_at: datetime) -> dict:
    data = json.loads(json.dumps(_load("dallas-denver.trip.json")))  # deep copy
    delta = depart_at - datetime.fromisoformat(data["routes"][0]["departure"])
    hourly_delta = timedelta(hours=round(delta.total_seconds() / 3600))
    for route in data["routes"]:
        for field in TRIP_TIME_FIELDS:
            route[field] = _shift(route[field], delta)
        for cp in route["checkpoints"]:
            cp["eta"] = _shift(cp["eta"], delta)
            # Forecasts are hourly: move the forecast hour by whole hours only.
            cp["forecast_time"] = _shift(cp.get("forecast_time"), hourly_delta)
    data["demo"] = True
    return data


# The two ends of the recorded trip, so the form can be filled without a routing key either.
# Demo mode promises no TomTom calls, and autocomplete is a TomTom call like any other.
DEMO_PLACES = [
    {"label": "Dallas, TX, United States", "lat": 32.77671, "lon": -96.79702},
    {"label": "Denver, CO, United States", "lat": 39.73923, "lon": -104.99025},
]


def places(query: str) -> list[dict]:
    """Fixture matches for a typeahead query, filtered the way a search service would."""
    needle = query.strip().lower()
    return [p for p in DEMO_PLACES if needle in p["label"].lower()]


def heatmap() -> dict:
    return _load("dallas-denver.heatmap.json") | {
        "start": int(time.time() // 3600 * 3600),
        "demo": True,
    }
