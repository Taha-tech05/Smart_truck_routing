"""Trip analysis orchestration: the only module that connects the others.

No Django imports. Returns plain JSON-serialisable dicts.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from ..constants import WEATHER_PRECISION_ANALYZE
from . import routing_client, summary as summary_service, weather_client
from .checkpoints import sample_checkpoints
from .recommend import (
    CheckpointResult,
    RouteStats,
    WeatherSample,
    build_recommendation,
    compute_route_stats,
    rank_routes,
)
from .risk import RiskLevel, assess_checkpoint


def _level_name(level: RiskLevel) -> str:
    return level.label


def _stats_dict(stats: RouteStats) -> dict[str, Any]:
    return {
        "severe_miles": round(stats.severe_miles, 2),
        "high_miles": round(stats.high_miles, 2),
        "no_travel_miles": round(stats.no_travel_miles, 2),
        "avg_risk": round(stats.avg_risk, 3),
        "has_no_travel": stats.has_no_travel,
        "worst_level": int(stats.worst_level),
        "worst_level_name": _level_name(stats.worst_level),
        "miles_by_level": {
            lvl.name.lower(): round(m, 2) for lvl, m in stats.miles_by_level.items()
        },
    }


def _checkpoint_dict(result: CheckpointResult, beyond: bool) -> dict[str, Any]:
    cp, w, a = result.checkpoint, result.weather, result.assessment
    return {
        "index": cp.index,
        "lat": cp.lat,
        "lng": cp.lng,
        "mile": round(cp.mile, 2),
        "eta": cp.eta.isoformat(),
        "covers_start": round(cp.covers_start, 2),
        "covers_end": round(cp.covers_end, 2),
        "weather": {
            "wind_mph": w.wind_mph,
            "rain_in_hr": w.rain_in_hr,
            "snow_in_hr": w.snow_in_hr,
        },
        "risk": {
            "level": int(a.level),
            "level_name": _level_name(a.level),
            "reasons": list(a.reasons),
        },
        "beyond_forecast": beyond,
    }


def analyze_trip(
    origin: dict,
    destination: dict,
    departure: datetime,
    load_lb: float,
    interval_miles: int,
) -> dict[str, Any]:
    """Analyse weather risk for every candidate route and recommend one.

    ``origin`` / ``destination`` are dicts with ``lat`` and ``lng``.
    """
    routes_result = routing_client.get_routes(
        (origin["lat"], origin["lng"]), (destination["lat"], destination["lng"])
    )
    routes = routes_result.routes
    warnings = list(routes_result.warnings)

    sampled = [
        sample_checkpoints(r.coordinates, r.duration_s, departure, interval_miles)
        for r in routes
    ]

    # One batched weather call for every checkpoint of every route (the weather
    # client de-duplicates and caches overlapping points).
    queries = [(cp.lat, cp.lng, cp.eta) for cps in sampled for cp in cps]
    weather = weather_client.weather_at(queries, precision=WEATHER_PRECISION_ANALYZE)

    route_payloads: dict[str, dict[str, Any]] = {}
    ranked_input: list[tuple[str, RouteStats]] = []
    cursor = 0
    beyond_count = 0
    for route, cps in zip(routes, sampled):
        results: list[CheckpointResult] = []
        cp_dicts: list[dict[str, Any]] = []
        for cp in cps:
            w = weather[cursor]
            cursor += 1
            sample = WeatherSample(w.wind_mph, w.rain_in_hr, w.snow_in_hr)
            assessment = assess_checkpoint(w.wind_mph, w.rain_in_hr, w.snow_in_hr, load_lb)
            result = CheckpointResult(cp, sample, assessment)
            results.append(result)
            cp_dicts.append(_checkpoint_dict(result, w.beyond_forecast))
            beyond_count += int(w.beyond_forecast)
        stats = compute_route_stats(results, route.distance_miles, route.duration_s)
        ranked_input.append((route.id, stats))
        route_payloads[route.id] = {
            "id": route.id,
            "summary": route.summary,
            "distance_miles": round(route.distance_miles, 2),
            "duration_s": round(route.duration_s),
            "geometry": {
                "type": "LineString",
                "coordinates": [[lng, lat] for lng, lat in route.coordinates],
            },
            "stats": _stats_dict(stats),
            "checkpoints": cp_dicts,
        }

    ranked = rank_routes(ranked_input)

    # Descriptive titles ("Via Amarillo, TX") and "+1 h 14 min vs fastest"; never fails the analysis.
    by_id = {r.id: r for r in routes}
    names = summary_service.build_summaries(
        [summary_service.RouteInput(rid, by_id[rid].coordinates, by_id[rid].duration_s) for rid, _ in ranked],
        origin,
        destination,
    )
    warnings.extend(names.warnings)
    for rid, text in names.summaries.items():
        route_payloads[rid]["summary"] = text
        route_payloads[rid]["delta_label"] = names.delta_labels[rid]
    rec = build_recommendation(ranked, names.summaries)

    out_routes = []
    for rank, (route_id, _stats) in enumerate(ranked, start=1):
        payload = route_payloads[route_id]
        payload["rank"] = rank
        payload["recommended"] = rank == 1 and not rec.all_unsafe
        out_routes.append(payload)

    if beyond_count:
        warnings.append(
            f"{beyond_count} checkpoint(s) are beyond the weather forecast window; "
            "the last available forecast hour was used for them."
        )

    return {
        "routes": out_routes,
        "recommendation": {
            "route_id": rec.route_id,
            "explanation": rec.explanation,
            "all_unsafe": rec.all_unsafe,
        },
        "warnings": warnings,
    }
