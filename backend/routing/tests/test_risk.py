import pytest

from routing.risk import (
    RiskLevel,
    assess,
    load_adjusted_wind_level,
    rain_level,
    snow_level,
    wind_level,
)

L, M, H, S, N = (
    RiskLevel.LOW,
    RiskLevel.MODERATE,
    RiskLevel.HIGH,
    RiskLevel.SEVERE,
    RiskLevel.NO_TRAVEL,
)


@pytest.mark.parametrize(
    ("mph", "expected"),
    [
        (0, L),
        (24.9, L),
        (25, M),
        (34.9, M),
        (35, H),
        (44.9, H),
        (45, S),
        (54.9, S),
        (55, N),
        (80, N),
    ],
)
def test_wind_bands(mph, expected):
    assert wind_level(mph) == expected


@pytest.mark.parametrize(
    ("in_hr", "expected"),
    [
        (0, L),
        (0.099, L),
        (0.10, M),
        (0.249, M),
        (0.25, H),  # shared boundary → higher level
        (0.499, H),
        (0.50, S),
        (1.00, S),  # brief: No Travel is strictly > 1.00
        (1.001, N),
    ],
)
def test_rain_bands(in_hr, expected):
    assert rain_level(in_hr) == expected


@pytest.mark.parametrize(
    ("in_hr", "expected"),
    [
        (0, L),
        (0.49, L),
        (0.5, M),
        (0.99, M),
        (1.0, H),
        (1.99, H),
        (2.0, S),
        (3.0, S),  # brief: No Travel is strictly > 3.0
        (3.01, N),
    ],
)
def test_snow_bands(in_hr, expected):
    assert snow_level(in_hr) == expected


@pytest.mark.parametrize(
    ("mph", "weight", "expected"),
    [
        # ≥55 mph → No Travel for any load
        (55, 0, N),
        (60, 80_000, N),
        # 45–54 mph + >30,000 lb → No Travel
        (45, 30_000, S),
        (45, 30_001, N),
        (54.9, 45_000, N),
        # 35–44 mph + >40,000 lb → Severe
        (35, 40_000, H),
        (35, 40_001, S),
        (44.9, 80_000, S),
        # Below 35 mph the load never matters
        (34.9, 80_000, M),
        (10, 80_000, L),
    ],
)
def test_load_rules(mph, weight, expected):
    assert load_adjusted_wind_level(mph, weight) == expected


def test_overall_is_worst_condition():
    result = assess(wind_mph=10, rain_in_hr=0.3, snow_in_hr=0.6, weight_lb=20_000)
    assert result.level == H
    assert result.drivers == ["rain"]


def test_load_escalation_is_reported():
    result = assess(wind_mph=40, rain_in_hr=0, snow_in_hr=0, weight_lb=42_000)
    assert result.level == S
    assert result.load_escalated is True
    assert result.drivers == ["wind"]


def test_ties_list_every_driver():
    result = assess(wind_mph=36, rain_in_hr=0.3, snow_in_hr=0, weight_lb=10_000)
    assert result.level == H
    assert result.drivers == ["wind", "rain"]


def test_calm_weather_has_no_drivers():
    result = assess(wind_mph=5, rain_in_hr=0, snow_in_hr=0, weight_lb=80_000)
    assert result.level == L
    assert result.drivers == []
