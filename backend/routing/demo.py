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
CHECKPOINT_TIME_FIELDS = ("eta", "forecast_time")


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
    for route in data["routes"]:
        for field in TRIP_TIME_FIELDS:
            route[field] = _shift(route[field], delta)
        for cp in route["checkpoints"]:
            for field in CHECKPOINT_TIME_FIELDS:
                cp[field] = _shift(cp.get(field), delta)
    data["demo"] = True
    return data


def heatmap() -> dict:
    return _load("dallas-denver.heatmap.json") | {
        "start": int(time.time() // 3600 * 3600),
        "demo": True,
    }
