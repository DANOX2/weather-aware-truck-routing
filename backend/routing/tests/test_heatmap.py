import base64
import itertools
import math

import pytest

from routing import heatmap
from routing.heatmap import INDEX_SCALE, MAX_CELLS, build_heatmap, corridor_cells, risk_index
from routing.providers.open_meteo import HourlyForecast
from routing.risk import assess

WINDS = [0, 10, 24.9, 25, 30, 35, 40, 45, 50, 55, 70]
RAINS = [0, 0.05, 0.1, 0.2, 0.25, 0.4, 0.5, 0.9, 1.0, 1.2]
SNOWS = [0, 0.3, 0.5, 0.8, 1.0, 1.5, 2.0, 3.0, 3.5]
WEIGHTS = [10_000, 35_000, 45_000]


@pytest.mark.parametrize("weight", WEIGHTS)
def test_index_always_agrees_with_checkpoint_level(weight):
    for wind, rain, snow in itertools.product(WINDS, RAINS, SNOWS):
        index = risk_index(wind, rain, snow, weight)
        assert math.floor(index) == assess(wind, rain, snow, weight).level, (wind, rain, snow)


def test_index_rises_smoothly_within_a_band():
    assert risk_index(26, 0, 0, 10_000) < risk_index(33, 0, 0, 10_000) < 2


def test_corridor_respects_cell_budget():
    # Seattle → Miami diagonal: long enough to force bigger cells.
    path = [(47.6 - i * 0.2, -122.3 + i * 0.4) for i in range(105)]
    size, cells = corridor_cells([path])
    assert len(cells) <= MAX_CELLS
    assert size > 0.25


def test_short_trip_uses_finest_cells():
    size, _ = corridor_cells([[(32.8, -96.8), (33.5, -97.5)]])
    assert size == 0.25


def test_build_heatmap_packs_49_hours_per_cell(monkeypatch):
    def fake_forecasts(coords, grid_deg):
        return {
            (round(lat, 4), round(lon, 4)): HourlyForecast(
                start_ts=0,
                wind_mph=(40.0,) * 10**6,
                gust_mph=(40.0,) * 10**6,
                rain_in_hr=(0.0,) * 10**6,
                snow_in_hr=(0.0,) * 10**6,
            )
            for lat, lon in coords
        }

    monkeypatch.setattr(heatmap.open_meteo, "get_forecasts", fake_forecasts)
    result = build_heatmap([[(32.8, -96.8), (34.0, -98.0)]], weight_lb=42_000)

    values = base64.b64decode(result["values"])
    assert len(values) == result["hours"] * len(result["cells"]) == 49 * len(result["cells"])
    # 40 mph gusts + 42,000 lb → Severe (3.x) everywhere
    assert {math.floor(v / INDEX_SCALE) for v in values} == {3}
    grid = result["grid"]
    assert max(result["cells"]) < grid["nx"] * grid["ny"]
