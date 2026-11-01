"""Tests for services.recommend."""
from datetime import datetime, timezone

import pytest

from routing.services.checkpoints import Checkpoint
from routing.services.recommend import (
    CheckpointResult,
    RouteStats,
    WeatherSample,
    build_recommendation,
    compute_route_stats,
    rank_routes,
)
from routing.services.risk import RiskAssessment, RiskLevel as L

T0 = datetime(2026, 11, 2, 8, 0, tzinfo=timezone.utc)
H = 3600


def result(level: L, covers: float, index: int = 0) -> CheckpointResult:
    cp = Checkpoint(index, 40.0, -100.0, 0.0, T0, 0.0, covers, covers)
    a = RiskAssessment(level, level, L.LOW, L.LOW, [])
    return CheckpointResult(cp, WeatherSample(10, 0, 0), a)


def stats(severe=0.0, high=0.0, hours=9.0, avg=0.0, no_travel=0.0, dist=100.0):
    return RouteStats(
        distance_miles=dist,
        duration_s=hours * H,
        miles_by_level={l: 0.0 for l in L},
        severe_miles=severe,
        high_miles=high,
        no_travel_miles=no_travel,
        has_no_travel=no_travel > 0,
        avg_risk=avg,
        worst_level=L.LOW,
    )


def ids(ranked):
    return [r[0] for r in ranked]


# ---------------- compute_route_stats ----------------

def test_stats_hand_computed_weighted_average():
    res = [result(L.LOW, 10), result(L.MODERATE, 30), result(L.HIGH, 60)]
    s = compute_route_stats(res, 100, 7200)
    assert s.avg_risk == pytest.approx((0 * 10 + 1 * 30 + 2 * 60) / 100)  # 1.5
    assert s.high_miles == 60
    assert s.severe_miles == 0
    assert s.worst_level == L.HIGH
    assert not s.has_no_travel
    assert s.duration_s == 7200


def test_stats_miles_by_level_sums_to_distance():
    res = [result(L.LOW, 12.5), result(L.SEVERE, 25), result(L.NO_TRAVEL, 37.5),
           result(L.HIGH, 25)]
    s = compute_route_stats(res, 100, 3600)
    assert sum(s.miles_by_level.values()) == pytest.approx(100)
    assert s.severe_miles == 25 and s.no_travel_miles == 37.5
    assert s.has_no_travel and s.worst_level == L.NO_TRAVEL


def test_stats_empty_raises():
    with pytest.raises(ValueError):
        compute_route_stats([], 10, 10)


# ---------------- rank_routes ----------------

def test_abc_table_b_wins():
    routes = [("A", stats(0, 80, 9)), ("B", stats(0, 30, 10)), ("C", stats(50, 0, 8))]
    assert ids(rank_routes(routes)) == ["B", "A", "C"]


def test_severe_beats_speed():
    routes = [("fast", stats(severe=5, hours=1)), ("slow", stats(severe=0, hours=20))]
    assert ids(rank_routes(routes)) == ["slow", "fast"]


def test_tie_on_severe_high_falls_to_avg_risk_then_duration():
    routes = [("x", stats(1, 2, 5, avg=1.4)), ("y", stats(1, 2, 9, avg=1.0))]
    assert ids(rank_routes(routes)) == ["y", "x"]
    routes = [("slow", stats(1, 2, 9, avg=1.0)), ("fast", stats(1, 2, 5, avg=1.0))]
    assert ids(rank_routes(routes)) == ["fast", "slow"]


def test_float_noise_does_not_break_ties():
    routes = [("a", stats(0.0000001, 2, 9)), ("b", stats(0.0, 2, 5))]
    assert ids(rank_routes(routes)) == ["b", "a"]  # tie on severe -> faster b first
    routes = [("a", stats(0.04, 2, 5)), ("b", stats(0.0, 2, 9))]
    assert ids(rank_routes(routes)) == ["a", "b"]  # 0.04 rounds to 0.0 -> tie, a faster


def test_no_travel_ranks_last_but_returned():
    routes = [("fast", stats(no_travel=10, hours=1)), ("ok", stats(severe=30, hours=9))]
    ranked = rank_routes(routes)
    assert ids(ranked) == ["ok", "fast"]
    assert len(ranked) == 2


# ---------------- build_recommendation ----------------

def test_all_unsafe():
    ranked = rank_routes([("A", stats(no_travel=5)), ("B", stats(no_travel=9, hours=2))])
    rec = build_recommendation(ranked)
    assert rec.all_unsafe is True
    assert "no route is advisable" in rec.explanation.lower()


def test_explanation_deciding_severe():
    rec = build_recommendation(rank_routes([("A", stats(0)), ("B", stats(42))]))
    assert rec.route_id == "A" and not rec.all_unsafe
    assert rec.explanation == "0 Severe miles vs 42 on Route B"


def test_explanation_deciding_high():
    rec = build_recommendation(rank_routes([("A", stats(0, 30)), ("B", stats(0, 80))]))
    assert rec.route_id == "A"
    assert rec.explanation == "30 High-risk miles vs 80 on Route B"


def test_explanation_deciding_avg_risk():
    rec = build_recommendation(rank_routes([("A", stats(0, 0, avg=0.5)), ("B", stats(0, 0, avg=1.2))]))
    assert rec.route_id == "A"
    assert "average risk" in rec.explanation and "0.5 vs 1.2 on Route B" in rec.explanation


def test_explanation_deciding_duration():
    rec = build_recommendation(rank_routes([
        ("B", stats(0, 0, hours=10)), ("A", stats(0, 0, hours=10 - 25 / 60))]))
    assert rec.route_id == "A"
    assert rec.explanation == "Same weather risk as Route B but 25 minutes faster"


def test_explanation_deciding_no_travel():
    rec = build_recommendation(rank_routes([("A", stats(no_travel=5, hours=1)), ("B", stats(severe=40))]))
    assert rec.route_id == "B"
    assert "No Travel" in rec.explanation and "Route A" in rec.explanation


def test_route_id_naming_and_single_route():
    rec = build_recommendation(rank_routes([("route-1", stats(0)), ("route-2", stats(9))]))
    assert rec.explanation.endswith("on Route 2")
    single = build_recommendation([("route-1", stats(0))])
    assert single.route_id == "route-1" and not single.all_unsafe


def test_empty_recommendation_raises():
    with pytest.raises(ValueError):
        build_recommendation([])
