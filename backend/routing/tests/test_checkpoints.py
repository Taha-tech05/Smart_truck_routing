"""Tests for services.checkpoints."""
import math
from datetime import datetime, timezone

import pytest

from routing.constants import EARTH_RADIUS_MILES
from routing.services.checkpoints import (
    haversine_miles,
    point_at_mile,
    route_length_miles,
    sample_checkpoints,
)

DEP = datetime(2026, 11, 2, 8, 0, tzinfo=timezone.utc)
DEG_PER_MILE = math.degrees(1 / EARTH_RADIUS_MILES)


def line(miles: float, parts: int = 4):
    """A straight north-south line of ``miles`` as (lng, lat) vertices."""
    return [(-100.0, 40.0 + DEG_PER_MILE * miles * i / parts) for i in range(parts + 1)]


def miles_of(cps):
    return [c.mile for c in cps]


def test_haversine_one_degree_latitude():
    assert haversine_miles(40, -100, 41, -100) == pytest.approx(69.09, abs=0.1)


def test_haversine_zero():
    assert haversine_miles(10, 10, 10, 10) == 0


def test_100_miles_interval_25():
    cps = sample_checkpoints(line(100), 3600, DEP, 25)
    assert miles_of(cps) == pytest.approx([0, 25, 50, 75, 100])


def test_100_miles_interval_10_has_11():
    cps = sample_checkpoints(line(100), 3600, DEP, 10)
    assert len(cps) == 11
    assert miles_of(cps) == pytest.approx(list(range(0, 101, 10)))


def test_60_miles_interval_25():
    cps = sample_checkpoints(line(60), 3600, DEP, 25)
    assert miles_of(cps) == pytest.approx([0, 25, 50, 60])


def test_last_regular_within_1_mile_dropped():
    cps = sample_checkpoints(line(100.5), 3600, DEP, 25)
    assert miles_of(cps) == pytest.approx([0, 25, 50, 75, 100.5])


def test_route_shorter_than_interval():
    cps = sample_checkpoints(line(7), 600, DEP, 25)
    assert miles_of(cps) == pytest.approx([0, 7])


def test_eta_halfway_of_10_hour_trip():
    cps = sample_checkpoints(line(100), 10 * 3600, DEP, 50)
    assert cps[0].eta == DEP
    assert cps[1].eta == DEP.replace(hour=13)
    assert cps[-1].eta == DEP.replace(hour=18)
    assert cps[1].eta.tzinfo is not None


def test_coverage_example():
    cps = sample_checkpoints(line(100), 3600, DEP, 25)
    got = [v for c in cps for v in (c.covers_start, c.covers_end)]
    expected = [0, 12.5, 12.5, 37.5, 37.5, 62.5, 62.5, 87.5, 87.5, 100]
    assert got == pytest.approx(expected)


@pytest.mark.parametrize("miles", [3, 7.5, 60, 100, 100.5, 333.3])
@pytest.mark.parametrize("interval", [10, 25, 50])
def test_coverage_sums_to_length(miles, interval):
    coords = line(miles, parts=7)
    cps = sample_checkpoints(coords, 3600, DEP, interval)
    assert sum(c.covers_miles for c in cps) == pytest.approx(route_length_miles(coords))
    for a, b in zip(cps, cps[1:]):
        assert a.covers_end == pytest.approx(b.covers_start)


def test_duplicate_consecutive_coordinates_skipped():
    base = line(60, parts=2)
    coords = [base[0], base[0], base[1], base[1], base[1], base[2]]
    cps = sample_checkpoints(coords, 3600, DEP, 25)
    assert miles_of(cps) == pytest.approx([0, 25, 50, 60])


def test_point_at_mile_lies_on_segment():
    a, b = (-100.0, 40.0), (-98.0, 41.5)
    p = point_at_mile([a, b], 20)
    total = haversine_miles(a[1], a[0], b[1], b[0])
    d1 = haversine_miles(a[1], a[0], p[1], p[0])
    d2 = haversine_miles(p[1], p[0], b[1], b[0])
    assert d1 == pytest.approx(20, rel=1e-2)
    assert d1 + d2 == pytest.approx(total, rel=1e-3)


def test_point_at_mile_multi_segment_and_clamp():
    coords = line(100, parts=4)
    assert point_at_mile(coords, 50) == pytest.approx((-100.0, 40.0 + DEG_PER_MILE * 50))
    assert point_at_mile(coords, -5) == coords[0]
    assert point_at_mile(coords, 999) == coords[-1]


@pytest.mark.parametrize(
    "coords,interval,dep",
    [
        ([(0, 0)], 25, DEP),
        ([], 25, DEP),
        ([(0, 0), (0, 0)], 25, DEP),
        ([(0, 0), (0, 1)], 20, DEP),
        ([(0, 0), (0, 1)], 25, datetime(2026, 1, 1)),
    ],
)
def test_invalid_inputs_raise(coords, interval, dep):
    with pytest.raises(ValueError):
        sample_checkpoints(coords, 3600, dep, interval)
