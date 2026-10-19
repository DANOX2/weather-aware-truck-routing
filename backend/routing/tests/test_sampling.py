import pytest

from routing.sampling import (
    METERS_PER_MILE,
    RouteGeometry,
    cumulative_distances,
    haversine_m,
    sample_checkpoints,
)


def straight_route(miles: float, mph: float = 60.0) -> RouteGeometry:
    """Due-north line from the equator, constant speed, one vertex per mile."""
    deg_per_mile = METERS_PER_MILE / haversine_m((0, 0), (1, 0))
    n = int(miles)
    lats = [i * deg_per_mile for i in range(n + 1)]
    if miles > n:
        lats.append(miles * deg_per_mile)
    coords = [(lat, 0.0) for lat in lats]
    dists = cumulative_distances(coords)
    times = [d / METERS_PER_MILE / mph * 3600 for d in dists]
    return RouteGeometry(tuple(coords), tuple(dists), tuple(times))


def test_checkpoints_every_interval_plus_destination():
    cps = sample_checkpoints(straight_route(60), interval_mi=25)
    assert [round(c.mile) for c in cps] == [0, 25, 50, 60]


def test_represented_miles_add_up_to_route_length():
    route = straight_route(137.4)
    for interval in (10, 25, 50):
        cps = sample_checkpoints(route, interval)
        assert sum(c.represents_mi for c in cps) == pytest.approx(137.4, abs=0.01)


def test_represented_miles_split_halfway_to_neighbours():
    cps = sample_checkpoints(straight_route(60), interval_mi=25)
    assert [round(c.represents_mi, 1) for c in cps] == [12.5, 25.0, 17.5, 5.0]


def test_checkpoint_near_destination_is_merged():
    cps = sample_checkpoints(straight_route(50.4), interval_mi=25)
    assert [round(c.mile, 1) for c in cps] == [0, 25, 50.4]


def test_eta_follows_route_travel_time():
    cps = sample_checkpoints(straight_route(100, mph=50), interval_mi=50)
    assert [round(c.elapsed_s / 3600, 2) for c in cps] == [0, 1, 2]


def test_position_is_interpolated_along_route():
    route = straight_route(30)
    cp = sample_checkpoints(route, interval_mi=10)[1]
    assert haversine_m(route.coords[0], (cp.lat, cp.lon)) / METERS_PER_MILE == pytest.approx(
        10, abs=0.01
    )


def test_rejects_unsupported_interval():
    with pytest.raises(ValueError):
        sample_checkpoints(straight_route(30), interval_mi=15)
