"""Route aggregation and ranking. Pure functions, no I/O, no Django imports.

Inputs are already in miles / mph / inches-per-hour / seconds; no unit
conversion happens here.

Ranking key (lexicographic, ascending, lower is better):
    (has_no_travel, severe_miles, high_miles, avg_risk, duration_s)
severe_miles, high_miles and avg_risk are rounded to 1 decimal inside the key
so float noise cannot break ties. Routes with No Travel conditions rank last
but are still returned.
"""
from __future__ import annotations

from dataclasses import dataclass, field

from .checkpoints import Checkpoint
from .risk import RiskAssessment, RiskLevel


@dataclass(frozen=True)
class WeatherSample:
    wind_mph: float
    rain_in_hr: float
    snow_in_hr: float


@dataclass(frozen=True)
class CheckpointResult:
    checkpoint: Checkpoint
    weather: WeatherSample
    assessment: RiskAssessment


@dataclass(frozen=True)
class RouteStats:
    distance_miles: float
    duration_s: float
    miles_by_level: dict[RiskLevel, float] = field(default_factory=dict)
    severe_miles: float = 0.0
    high_miles: float = 0.0
    no_travel_miles: float = 0.0
    has_no_travel: bool = False
    avg_risk: float = 0.0  # distance-weighted mean of level values (0-4)
    worst_level: RiskLevel = RiskLevel.LOW


@dataclass(frozen=True)
class Recommendation:
    route_id: str | None
    explanation: str
    all_unsafe: bool


RankedRoute = tuple[str, RouteStats]


def compute_route_stats(
    results: list[CheckpointResult], distance_miles: float, duration_s: float
) -> RouteStats:
    """Aggregate per-checkpoint assessments into route-level stats.

    Each checkpoint contributes its ``covers_miles`` at its risk level.
    """
    if not results:
        raise ValueError("results must not be empty")
    by_level = {lvl: 0.0 for lvl in RiskLevel}
    for r in results:
        by_level[r.assessment.level] += r.checkpoint.covers_miles
    covered = sum(by_level.values())
    avg = sum(int(lvl) * m for lvl, m in by_level.items()) / covered if covered > 0 else 0.0
    worst = max(r.assessment.level for r in results)
    return RouteStats(
        distance_miles=distance_miles,
        duration_s=duration_s,
        miles_by_level=by_level,
        severe_miles=by_level[RiskLevel.SEVERE],
        high_miles=by_level[RiskLevel.HIGH],
        no_travel_miles=by_level[RiskLevel.NO_TRAVEL],
        has_no_travel=by_level[RiskLevel.NO_TRAVEL] > 0,
        avg_risk=avg,
        worst_level=worst,
    )


def _key(stats: RouteStats) -> tuple:
    return (
        stats.has_no_travel,
        round(stats.severe_miles, 1),
        round(stats.high_miles, 1),
        round(stats.avg_risk, 1),
        stats.duration_s,
    )


def rank_routes(routes: list[RankedRoute]) -> list[RankedRoute]:
    """Return routes ordered best-first (stable for exact ties)."""
    return sorted(routes, key=lambda item: _key(item[1]))


def _name(route_id: str) -> str:
    if route_id.lower().startswith("route"):
        return route_id.replace("-", " ").replace("_", " ").title()
    return f"Route {route_id}"


def _fmt(x: float) -> str:
    return f"{round(x, 1):g}"


def _duration_text(seconds: float) -> str:
    minutes = round(seconds / 60)
    if minutes >= 60:
        h, m = divmod(minutes, 60)
        return f"{h} h {m} min" if m else f"{h} h"
    return f"{minutes} minutes"


def build_recommendation(ranked: list[RankedRoute]) -> Recommendation:
    """Explain why the top-ranked route beats the runner-up, in plain English."""
    if not ranked:
        raise ValueError("no routes to recommend")
    win_id, win = ranked[0]

    if all(stats.has_no_travel for _, stats in ranked):
        return Recommendation(
            route_id=win_id,
            explanation=(
                "No route is advisable at this departure time: every route has "
                "No Travel conditions. Consider leaving at a different time."
            ),
            all_unsafe=True,
        )
    if len(ranked) == 1:
        return Recommendation(win_id, "Only one route is available.", False)

    run_id, run = ranked[1]
    rn = _name(run_id)
    if win.has_no_travel != run.has_no_travel:
        text = f"Avoids No Travel conditions that occur on {rn}"
    elif round(win.severe_miles, 1) != round(run.severe_miles, 1):
        text = f"{_fmt(win.severe_miles)} Severe miles vs {_fmt(run.severe_miles)} on {rn}"
    elif round(win.high_miles, 1) != round(run.high_miles, 1):
        text = f"{_fmt(win.high_miles)} High-risk miles vs {_fmt(run.high_miles)} on {rn}"
    elif round(win.avg_risk, 1) != round(run.avg_risk, 1):
        text = (
            f"Lower average risk ({_fmt(win.avg_risk)} vs {_fmt(run.avg_risk)} "
            f"on {rn}) with similar Severe and High-risk exposure"
        )
    elif win.duration_s != run.duration_s:
        text = (
            f"Same weather risk as {rn} but "
            f"{_duration_text(run.duration_s - win.duration_s)} faster"
        )
    else:
        text = f"Same weather risk and travel time as {rn}"
    return Recommendation(win_id, text, False)
