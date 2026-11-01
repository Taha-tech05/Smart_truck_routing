"""Sample checkpoints along a route with ETAs and coverage. Pure functions, no I/O.

Coordinates are ``(lng, lat)`` tuples (GeoJSON order) everywhere in this module.

Coverage method: each checkpoint "covers" the stretch of road from the midpoint
between it and the previous checkpoint to the midpoint between it and the next
one. The first checkpoint starts at mile 0 and the last ends at the route length,
so the covered stretches tile the route exactly.
"""
from __future__ import annotations

import math
from bisect import bisect_left
from dataclasses import dataclass
from datetime import datetime, timedelta

from ..constants import ALLOWED_INTERVALS, EARTH_RADIUS_MILES

Coord = tuple[float, float]  # (lng, lat)

_EPS = 1e-9
_END_MERGE_MILES = 1.0


@dataclass(frozen=True)
class Checkpoint:
    index: int
    lat: float
    lng: float
    mile: float
    eta: datetime
    covers_start: float
    covers_end: float
    covers_miles: float


def haversine_miles(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    """Great-circle distance in miles between two lat/lng points."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp = p2 - p1
    dl = math.radians(lng2 - lng1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_RADIUS_MILES * math.asin(min(1.0, math.sqrt(a)))


def _dedupe(coordinates: list[Coord]) -> list[Coord]:
    """Drop consecutive duplicate vertices (zero-length segments)."""
    out: list[Coord] = []
    for c in coordinates:
        if not out or haversine_miles(out[-1][1], out[-1][0], c[1], c[0]) > 0:
            out.append(c)
    return out


def route_length_miles(coordinates: list[Coord]) -> float:
    """Total polyline length in miles."""
    return sum(
        haversine_miles(a[1], a[0], b[1], b[0])
        for a, b in zip(coordinates, coordinates[1:])
    )


def cumulative_miles(coordinates: list[Coord]) -> list[float]:
    """Cumulative distance in miles at each vertex (``cum[0] == 0``)."""
    cum = [0.0]
    for a, b in zip(coordinates, coordinates[1:]):
        cum.append(cum[-1] + haversine_miles(a[1], a[0], b[1], b[0]))
    return cum


def interpolate_at(coordinates: list[Coord], cum: list[float], mile: float) -> Coord:
    """``(lng, lat)`` at ``mile`` given precomputed ``cum`` (O(log n) per lookup)."""
    if mile <= 0:
        return coordinates[0]
    if mile >= cum[-1]:
        return coordinates[-1]
    i = bisect_left(cum, mile)  # first vertex with cum[i] >= mile, so cum[i-1] < mile
    a, b = coordinates[i - 1], coordinates[i]
    f = (mile - cum[i - 1]) / (cum[i] - cum[i - 1])
    return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f)


def point_at_mile(coordinates: list[Coord], mile: float) -> Coord:
    """Return the ``(lng, lat)`` at ``mile`` along the polyline (linear interpolation).

    Miles outside ``[0, length]`` are clamped to the ends.
    """
    if len(coordinates) < 2:
        raise ValueError("at least 2 coordinates are required")
    return interpolate_at(coordinates, cumulative_miles(coordinates), mile)


def local_direction(
    coordinates: list[Coord], cum: list[float], mile: float, span_miles: float = 1.0
) -> tuple[float, float]:
    """Unit ``(east, north)`` direction of the route around ``mile``."""
    half = max(min(span_miles, cum[-1] / 4), 1e-6)
    before = interpolate_at(coordinates, cum, mile - half)
    after = interpolate_at(coordinates, cum, mile + half)
    mid_lat = (before[1] + after[1]) / 2
    east = (after[0] - before[0]) * max(math.cos(math.radians(mid_lat)), 1e-6)
    north = after[1] - before[1]
    norm = math.hypot(east, north) or 1.0
    return east / norm, north / norm


def offset_point(lng: float, lat: float, direction: tuple[float, float], miles: float) -> Coord:
    """Move ``miles`` from (lng, lat) along a unit (east, north) ``direction``."""
    dlat = math.degrees(miles * direction[1] / EARTH_RADIUS_MILES)
    dlng = math.degrees(
        miles * direction[0] / (EARTH_RADIUS_MILES * max(math.cos(math.radians(lat)), 1e-6))
    )
    return (lng + dlng, lat + dlat)


def sample_checkpoints(
    coordinates: list[Coord],
    total_duration_s: float,
    departure: datetime,
    interval_miles: int,
) -> list[Checkpoint]:
    """Sample checkpoints every ``interval_miles`` plus the end, with ETAs and coverage.

    Raises ValueError for a bad interval, naive departure, fewer than 2 distinct
    points, or a zero-length route.
    """
    if interval_miles not in ALLOWED_INTERVALS:
        raise ValueError(f"interval_miles must be one of {ALLOWED_INTERVALS}")
    if departure.tzinfo is None or departure.utcoffset() is None:
        raise ValueError("departure must be timezone-aware")
    if total_duration_s < 0:
        raise ValueError("total_duration_s must not be negative")
    if coordinates is None or len(coordinates) < 2:
        raise ValueError("at least 2 coordinates are required")

    coords = _dedupe(list(coordinates))
    cum = cumulative_miles(coords)
    total = cum[-1]
    if len(coords) < 2 or total <= 0:
        raise ValueError("route has zero length")

    miles = [0.0]
    m = float(interval_miles)
    while m < total - _EPS:
        miles.append(m)
        m += interval_miles
    # Drop the last regular checkpoint if it is within 1 mile of the end.
    if len(miles) > 1 and total - miles[-1] < _END_MERGE_MILES:
        miles.pop()
    miles.append(total)

    result: list[Checkpoint] = []
    for i, mile in enumerate(miles):
        start = 0.0 if i == 0 else (miles[i - 1] + mile) / 2
        end = total if i == len(miles) - 1 else (mile + miles[i + 1]) / 2
        lng, lat = interpolate_at(coords, cum, mile)
        eta = departure + timedelta(seconds=(mile / total) * total_duration_s)
        result.append(Checkpoint(i, lat, lng, mile, eta, start, end, end - start))
    return result
