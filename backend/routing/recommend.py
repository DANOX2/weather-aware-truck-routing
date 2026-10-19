"""Route statistics and the brief's ranking.

Ranking order (strict, as numbered in the brief):
  1. fewest Severe miles  2. fewest High miles  3. lowest average risk  4. shortest time
No Travel is not in the brief's list; any route with No Travel miles ranks
below every route without them, fewest No Travel miles first.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from functools import cmp_to_key

from .risk import RiskLevel

# Values within these tolerances count as a tie, so float noise never decides a route.
MILES_TOLERANCE = 0.05
RISK_TOLERANCE = 0.001
TIME_TOLERANCE_S = 30.0


@dataclass(frozen=True)
class RouteStats:
    distance_mi: float
    duration_s: float
    miles_by_level: dict[RiskLevel, float]
    avg_risk: float  # mile-weighted, Low=0 … No Travel=4

    @property
    def severe_mi(self) -> float:
        return self.miles_by_level[RiskLevel.SEVERE]

    @property
    def high_mi(self) -> float:
        return self.miles_by_level[RiskLevel.HIGH]

    @property
    def no_travel_mi(self) -> float:
        return self.miles_by_level[RiskLevel.NO_TRAVEL]


def route_stats(segments: Sequence[tuple[RiskLevel, float]], duration_s: float) -> RouteStats:
    """`segments` are (level, represented miles) per checkpoint."""
    miles = {level: 0.0 for level in RiskLevel}
    for level, mi in segments:
        miles[level] += mi
    total = sum(miles.values())
    avg = sum(level * mi for level, mi in miles.items()) / total if total else 0.0
    return RouteStats(distance_mi=total, duration_s=duration_s, miles_by_level=miles, avg_risk=avg)


# (key, label, getter, tolerance) in priority order
CRITERIA = (
    ("no_travel_miles", "Fewest No Travel miles", lambda s: s.no_travel_mi, MILES_TOLERANCE),
    ("severe_miles", "Fewest Severe miles", lambda s: s.severe_mi, MILES_TOLERANCE),
    ("high_miles", "Fewest High miles", lambda s: s.high_mi, MILES_TOLERANCE),
    ("avg_risk", "Lowest average risk", lambda s: s.avg_risk, RISK_TOLERANCE),
    ("duration", "Shortest travel time", lambda s: s.duration_s, TIME_TOLERANCE_S),
)


def _compare(a: RouteStats, b: RouteStats) -> tuple[int, str | None]:
    """-1 if a ranks first, 1 if b does, 0 on a full tie; plus the deciding criterion."""
    for key, _label, get, tol in CRITERIA:
        diff = get(a) - get(b)
        if abs(diff) > tol:
            return (-1 if diff < 0 else 1), key
    return 0, None


@dataclass(frozen=True)
class Ranking:
    order: list[int]  # route indexes, best first
    deciding_criterion: str | None  # what separated #1 from #2; None if one route or a tie
    deciding_label: str | None
    all_have_no_travel: bool


def rank_routes(stats: Sequence[RouteStats]) -> Ranking:
    # sorted() is stable, so tied routes keep provider order (TomTom's best first).
    order = sorted(range(len(stats)), key=cmp_to_key(lambda i, j: _compare(stats[i], stats[j])[0]))

    deciding = None
    if len(order) > 1:
        _, deciding = _compare(stats[order[0]], stats[order[1]])
    label = next((lbl for key, lbl, *_ in CRITERIA if key == deciding), None)
    return Ranking(
        order=order,
        deciding_criterion=deciding,
        deciding_label=label,
        all_have_no_travel=bool(stats) and all(s.no_travel_mi > MILES_TOLERANCE for s in stats),
    )
