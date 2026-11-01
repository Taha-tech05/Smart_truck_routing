"""Corridor risk heatmap: 48 hours of risk for a grid of points around a route.

The grid is built with pure geometry (``build_corridor_grid``); weather comes
from the shared ``weather_client`` (same batching and 30-minute cache as the
analyze endpoint). Only the integer risk level (0-4) is kept per point and hour,
and each point's 49 levels are packed into one digit string, so the frontend
slider can change hour with no further network calls.

Hour 0 is the current UTC hour (floored); hour 48 is two days later. The hour
index is found by matching timestamps in the Open-Meteo arrays, never by
assuming the arrays start at the current hour.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from typing import Any

from ..constants import (
    GRID_DEDUPE_MILES,
    WEATHER_PRECISION_DEFAULT,
    HEATMAP_HOURS,
    MAX_GRID_POINTS,
    MAX_ROUTE_VERTICES,
)
from . import weather_client
from .checkpoints import (
    Coord,
    cumulative_miles,
    haversine_miles,
    interpolate_at,
    local_direction,
    offset_point,
)
from .risk import RiskLevel, assess_checkpoint

LEVEL_NAMES = [lvl.label for lvl in RiskLevel]
_EPS = 1e-9
_SPACING_GROWTH = 1.15


@dataclass(frozen=True)
class GridPoint:
    lat: float
    lng: float
    mile_along: float
    offset_miles: float


def simplify(coords: list[Coord], max_points: int = MAX_ROUTE_VERTICES) -> list[Coord]:
    """Evenly decimate a polyline to at most ``max_points`` vertices (keeps both ends)."""
    n = len(coords)
    if n <= max_points:
        return list(coords)
    step = (n - 1) / (max_points - 1)
    return [coords[round(i * step)] for i in range(max_points)]


def _dedupe_coords(coords: list[Coord]) -> list[Coord]:
    out: list[Coord] = []
    for c in coords:
        if not out or haversine_miles(out[-1][1], out[-1][0], c[1], c[0]) > 0:
            out.append(c)
    return out


def _grid_at_spacing(
    coords: list[Coord], cum: list[float], spacing: float, corridor: float
) -> list[GridPoint]:
    total = cum[-1]
    miles = [0.0]
    m = spacing
    while m < total - _EPS:
        miles.append(m)
        m += spacing
    if len(miles) > 1 and total - miles[-1] < 1.0:
        miles.pop()
    miles.append(total)

    offsets = [0.0, -corridor / 2, corridor / 2, -corridor, corridor]  # centre first
    kept: list[GridPoint] = []
    for mile in miles:
        lng, lat = interpolate_at(coords, cum, mile)
        east, north = local_direction(coords, cum, mile)
        perp = (-north, east)  # left of travel direction
        for off in offsets:
            plng, plat = offset_point(lng, lat, perp, off) if off else (lng, lat)
            if any(
                haversine_miles(plat, plng, k.lat, k.lng) < GRID_DEDUPE_MILES for k in kept
            ):
                continue
            kept.append(GridPoint(plat, plng, mile, off))
    return kept


def build_corridor_grid(
    coords: list[Coord],
    spacing_miles: float,
    corridor_miles: float,
    max_points: int = MAX_GRID_POINTS,
) -> tuple[list[GridPoint], list[str]]:
    """Grid of points around the route and any warnings.

    Centre-line points every ``spacing_miles`` (plus the end), each with
    perpendicular offsets at -corridor, -corridor/2, 0, +corridor/2, +corridor
    miles from the local route bearing. Points closer than ~7 miles to an
    already-kept point are dropped. If the grid would exceed ``max_points`` the
    spacing is increased automatically and a warning is returned.
    """
    if spacing_miles <= 0 or corridor_miles <= 0:
        raise ValueError("spacing_miles and corridor_miles must be positive")
    if coords is None or len(coords) < 2:
        raise ValueError("at least 2 coordinates are required")
    coords = _dedupe_coords(list(coords))
    cum = cumulative_miles(coords)
    if len(coords) < 2 or cum[-1] <= 0:
        raise ValueError("route has zero length")

    spacing = float(spacing_miles)
    grid = _grid_at_spacing(coords, cum, spacing, corridor_miles)
    warnings: list[str] = []
    while len(grid) > max_points:
        spacing *= _SPACING_GROWTH
        grid = _grid_at_spacing(coords, cum, spacing, corridor_miles)
    if spacing > spacing_miles:
        warnings.append(
            f"Route is long: grid spacing increased from {spacing_miles:g} to "
            f"{spacing:.0f} miles to stay within {max_points} points."
        )
    return grid, warnings


def _level_chars(
    records: list[weather_client.HourlyRecord],
    slots: list[datetime],
    load_lb: float,
) -> tuple[str, int]:
    """Digit string of levels for ``slots`` (forward-filling gaps) and missing count."""
    by_time = {r.time_utc: r for r in records}
    chars: list[str] = []
    missing = 0
    previous = 0
    for slot in slots:
        rec = by_time.get(slot)
        if rec is None:
            missing += 1
            level = previous
        else:
            level = int(
                assess_checkpoint(rec.wind_mph, rec.rain_in_hr, rec.snow_in_hr, load_lb).level
            )
        chars.append(str(level))
        previous = level
    return "".join(chars), missing


def build_heatmap(
    coords: list[Coord],
    load_lb: float,
    corridor_miles: float = 30,
    spacing_miles: float = 25,
    now: datetime | None = None,
) -> dict[str, Any]:
    """Build the compact 49-hour corridor heatmap response."""
    now = now or datetime.now(timezone.utc)
    if now.tzinfo is None:
        raise ValueError("now must be timezone-aware")
    start = now.astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    slots = [start + timedelta(hours=h) for h in range(HEATMAP_HOURS + 1)]

    warnings: list[str] = []
    if len(coords) > MAX_ROUTE_VERTICES:
        coords = simplify(coords)
    grid, grid_warnings = build_corridor_grid(coords, spacing_miles, corridor_miles)
    warnings.extend(grid_warnings)

    pts = [(g.lat, g.lng) for g in grid]
    hourly = weather_client.get_hourly_weather(
        pts, hours_ahead=HEATMAP_HOURS, precision=WEATHER_PRECISION_DEFAULT
    )

    levels: list[str] = []
    missing = 0
    for p in pts:
        s, m = _level_chars(hourly[p], slots, load_lb)
        levels.append(s)
        missing += m
    if missing:
        warnings.append(
            f"{missing} hourly value(s) were missing from the forecast and were "
            "filled with the previous hour's level."
        )

    summary = []
    for h in range(len(slots)):
        counts = [0] * len(RiskLevel)
        for s in levels:
            counts[int(s[h])] += 1
        summary.append(
            {"hour": h, "max_level": max((i for i, c in enumerate(counts) if c), default=0),
             "counts": counts}
        )

    return {
        "start_time": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "hours": len(slots),
        "points": [[round(g.lat, 4), round(g.lng, 4), round(g.mile_along, 1)] for g in grid],
        "levels": levels,
        "level_names": LEVEL_NAMES,
        "summary": summary,
        "missing": missing,
        "warnings": warnings,
    }
