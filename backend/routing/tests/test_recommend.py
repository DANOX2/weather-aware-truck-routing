import pytest

from routing.recommend import rank_routes, route_stats
from routing.risk import RiskLevel

L, M, H, S, N = (
    RiskLevel.LOW,
    RiskLevel.MODERATE,
    RiskLevel.HIGH,
    RiskLevel.SEVERE,
    RiskLevel.NO_TRAVEL,
)


def stats(hours=10.0, **miles):
    """stats(L=100, S=20) → a route with 100 Low miles and 20 Severe miles."""
    levels = {"L": L, "M": M, "H": H, "S": S, "N": N}
    return route_stats([(levels[k], v) for k, v in miles.items()], hours * 3600)


def test_route_stats_mile_weighted_average():
    s = stats(L=50, H=50)
    assert s.distance_mi == 100
    assert s.avg_risk == pytest.approx(1.0)
    assert s.high_mi == 50


def test_fewest_severe_miles_wins_over_shorter_time():
    ranking = rank_routes([stats(hours=8, L=80, S=20), stats(hours=12, L=100)])
    assert ranking.order == [1, 0]
    assert ranking.deciding_criterion == "severe_miles"


def test_high_miles_break_severe_tie():
    ranking = rank_routes([stats(L=70, H=30), stats(L=90, H=10)])
    assert ranking.order == [1, 0]
    assert ranking.deciding_criterion == "high_miles"


def test_average_risk_breaks_high_tie():
    ranking = rank_routes([stats(L=50, M=50), stats(L=80, M=20)])
    assert ranking.order == [1, 0]
    assert ranking.deciding_criterion == "avg_risk"


def test_travel_time_is_last_resort():
    ranking = rank_routes([stats(hours=11, L=100), stats(hours=10, L=100)])
    assert ranking.order == [1, 0]
    assert ranking.deciding_criterion == "duration"


def test_no_travel_ranks_below_everything():
    # Route 0 has no Severe miles but a No Travel stretch; route 1 is all Severe.
    ranking = rank_routes([stats(L=95, N=5), stats(S=100)])
    assert ranking.order == [1, 0]
    assert ranking.deciding_criterion == "no_travel_miles"
    assert ranking.all_have_no_travel is False


def test_all_routes_no_travel_is_flagged():
    ranking = rank_routes([stats(L=90, N=10), stats(L=95, N=5)])
    assert ranking.order == [1, 0]
    assert ranking.all_have_no_travel is True


def test_float_noise_does_not_decide():
    ranking = rank_routes([stats(hours=10, L=100, S=10.00001), stats(hours=9, L=100, S=10)])
    assert ranking.deciding_criterion == "duration"
    assert ranking.order == [1, 0]


def test_full_tie_keeps_provider_order():
    ranking = rank_routes([stats(L=100), stats(L=100), stats(L=100)])
    assert ranking.order == [0, 1, 2]
    assert ranking.deciding_criterion is None


def test_three_routes_fully_ordered():
    ranking = rank_routes(
        [stats(hours=9, L=90, H=10), stats(hours=10, L=100), stats(hours=8, L=80, S=20)]
    )
    assert ranking.order == [1, 0, 2]
