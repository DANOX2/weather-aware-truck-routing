"""Weather risk classification for a single checkpoint.

Thresholds come straight from the assessment brief. Where the brief's ranges
share a boundary (e.g. rain 0.25 is listed under both Moderate and High) the
boundary value belongs to the *higher* level: every band is half-open
[lower, upper). The No Travel bands for rain and snow are strictly greater than
the Severe ceiling, as written in the brief ("> 1.00", "> 3.0").
"""

from __future__ import annotations

from dataclasses import dataclass
from enum import IntEnum


class RiskLevel(IntEnum):
    LOW = 0
    MODERATE = 1
    HIGH = 2
    SEVERE = 3
    NO_TRAVEL = 4


# Lower bounds (inclusive) for Moderate, High, Severe. No Travel is handled per condition.
WIND_MPH = (25.0, 35.0, 45.0)
WIND_NO_TRAVEL_MPH = 55.0  # >= 55
RAIN_IN_HR = (0.10, 0.25, 0.50)
RAIN_NO_TRAVEL_IN_HR = 1.00  # > 1.00
SNOW_IN_HR = (0.5, 1.0, 2.0)
SNOW_NO_TRAVEL_IN_HR = 3.0  # > 3.0

# Load rules: (wind band lower bound, weight strictly above, resulting level)
HEAVY_LOAD_NO_TRAVEL_LB = 30_000  # 45–54 mph
HEAVY_LOAD_SEVERE_LB = 40_000  # 35–44 mph


def _banded(value: float, bounds: tuple[float, float, float]) -> RiskLevel:
    moderate, high, severe = bounds
    if value >= severe:
        return RiskLevel.SEVERE
    if value >= high:
        return RiskLevel.HIGH
    if value >= moderate:
        return RiskLevel.MODERATE
    return RiskLevel.LOW


def wind_level(mph: float) -> RiskLevel:
    if mph >= WIND_NO_TRAVEL_MPH:
        return RiskLevel.NO_TRAVEL
    return _banded(mph, WIND_MPH)


def rain_level(in_hr: float) -> RiskLevel:
    if in_hr > RAIN_NO_TRAVEL_IN_HR:
        return RiskLevel.NO_TRAVEL
    return _banded(in_hr, RAIN_IN_HR)


def snow_level(in_hr: float) -> RiskLevel:
    if in_hr > SNOW_NO_TRAVEL_IN_HR:
        return RiskLevel.NO_TRAVEL
    return _banded(in_hr, SNOW_IN_HR)


def load_adjusted_wind_level(mph: float, weight_lb: float) -> RiskLevel:
    """Wind level after applying the brief's load rules."""
    level = wind_level(mph)
    if level == RiskLevel.SEVERE and weight_lb > HEAVY_LOAD_NO_TRAVEL_LB:
        return RiskLevel.NO_TRAVEL
    if level == RiskLevel.HIGH and weight_lb > HEAVY_LOAD_SEVERE_LB:
        return RiskLevel.SEVERE
    return level


@dataclass(frozen=True)
class Assessment:
    level: RiskLevel
    wind: RiskLevel
    rain: RiskLevel
    snow: RiskLevel
    load_escalated: bool  # wind level was raised by the load rules

    @property
    def drivers(self) -> list[str]:
        """Conditions responsible for the overall level, for UI explanations."""
        if self.level == RiskLevel.LOW:
            return []
        return [
            name
            for name, lvl in (("wind", self.wind), ("rain", self.rain), ("snow", self.snow))
            if lvl == self.level
        ]


def assess(wind_mph: float, rain_in_hr: float, snow_in_hr: float, weight_lb: float) -> Assessment:
    """Overall checkpoint risk: the worst of wind (load-adjusted), rain and snow."""
    raw_wind = wind_level(wind_mph)
    wind = load_adjusted_wind_level(wind_mph, weight_lb)
    rain = rain_level(rain_in_hr)
    snow = snow_level(snow_in_hr)
    return Assessment(
        level=max(wind, rain, snow),
        wind=wind,
        rain=rain,
        snow=snow,
        load_escalated=wind > raw_wind,
    )
