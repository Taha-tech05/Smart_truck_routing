"""Descriptive route labels ("Via Amarillo, TX") and "+1 h 14 min vs fastest" deltas.

Reverse-geocode failures never propagate: a route whose lookups fail simply
falls back to "Route N".
"""
from __future__ import annotations

import logging
import math
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from typing import Callable

from .checkpoints import point_at_mile, route_length_miles
from .routing_client import ors_request

log = logging.getLogger(__name__)

FRACTIONS = (0.25, 0.5, 0.75)
LOOKUP_TIMEOUT_S = 5.0
MAX_PLACES = 2
CACHE_PRECISION = 1  # 0.1 degree

# (rounded lat, rounded lng) -> (name, region) or None when there is no locality there.
# Only successful lookups are cached, never failures.
_cache: dict[tuple[float, float], tuple[str, str] | None] = {}

Place = tuple[str, str]  # (name, region abbreviation or "")
Lookup = Callable[[float, float], "Place | None"]


def clear_cache() -> None:
    _cache.clear()


@dataclass(frozen=True)
class RouteInput:
    id: str
    coordinates: list  # [(lng, lat), ...]
    duration_s: float


@dataclass(frozen=True)
class SummaryResult:
    summaries: dict[str, str]
    delta_labels: dict[str, str]
    warnings: list[str]


def _key(lat: float, lng: float) -> tuple[float, float]:
    return (round(lat, CACHE_PRECISION), round(lng, CACHE_PRECISION))


def reverse_locality(lat: float, lng: float, api_key: str | None = None) -> Place | None:
    """ORS reverse geocode (layers=locality, size=1). Raises on any failure."""
    data = ors_request(
        "GET",
        "/geocode/reverse",
        api_key=api_key,
        params={"point.lon": lng, "point.lat": lat, "layers": "locality", "size": 1},
        timeout=LOOKUP_TIMEOUT_S,
    )
    for feat in data.get("features", []):
        props = feat.get("properties", {})
        name = (props.get("name") or "").strip()
        if name:
            return name, (props.get("region_a") or "").strip()
    return None


def _cached_lookup(lat: float, lng: float, lookup: Lookup) -> tuple[bool, Place | None]:
    """Returns (ok, place). ok is False when the lookup itself failed."""
    k = _key(lat, lng)
    if k in _cache:
        return True, _cache[k]
    try:
        place = lookup(lat, lng)
    except Exception as exc:  # noqa: BLE001 - a label must never fail the analysis
        log.info("reverse geocode failed at %s: %s", k, exc)
        return False, None
    _cache[k] = place
    return True, place


def _fmt_duration(seconds: float) -> str:
    minutes = round(seconds / 60)
    h, m = divmod(abs(minutes), 60)
    return f"{h} h {m} min" if h else f"{m} min"


def delta_labels(routes: list[RouteInput]) -> dict[str, str]:
    fastest = min(r.duration_s for r in routes)
    return {
        r.id: "Fastest"
        if round(r.duration_s) <= round(fastest)
        else f"+{_fmt_duration(r.duration_s - fastest)} vs fastest"
        for r in routes
    }


def _city(label: str | None) -> str:
    return (label or "").split(",")[0].strip().casefold()


def _side(origin: dict, dest: dict, mid: tuple[float, float]) -> str:
    """Which side of the straight origin-destination line the (lng, lat) midpoint lies on."""
    ox, oy, dx, dy = origin["lng"], origin["lat"], dest["lng"], dest["lat"]
    cos = max(math.cos(math.radians((oy + dy) / 2)), 1e-6)
    vx, vy = (dx - ox) * cos, dy - oy
    px, py = (mid[0] - ox) * cos, mid[1] - oy
    cross = vx * py - vy * px  # > 0: left of the direction of travel
    if abs(vx) >= abs(vy):  # mostly east-west trip: compare north / south
        return "north" if (cross > 0) == (vx > 0) else "south"
    return "east" if (cross > 0) == (vy < 0) else "west"


def build_summaries(
    routes: list[RouteInput],
    origin: dict,
    destination: dict,
    api_key: str | None = None,
    lookup: Lookup | None = None,
) -> SummaryResult:
    """``routes`` must be in rank order: the fallback "Route N" uses that position."""
    if lookup is None:
        def lookup(lat, lng, _k=api_key):  # noqa: E306
            return reverse_locality(lat, lng, _k)

    skip = {_city(origin.get("label")), _city(destination.get("label"))} - {""}

    # sample points per route (lng, lat)
    points: list[list[tuple[float, float]]] = []
    for r in routes:
        coords = r.coordinates
        total = route_length_miles(coords) if len(coords) >= 2 else 0.0
        points.append([point_at_mile(coords, total * f) for f in FRACTIONS] if total > 0 else [])

    # look up every distinct 0.1-degree cell once, concurrently
    cells: dict[tuple[float, float], tuple[float, float]] = {}
    for pts in points:
        for lng, lat in pts:
            cells.setdefault(_key(lat, lng), (lat, lng))
    outcomes: dict[tuple[float, float], tuple[bool, Place | None]] = {}
    pending = {k: v for k, v in cells.items() if k not in _cache}
    outcomes.update({k: (True, _cache[k]) for k in cells if k in _cache})
    if pending:
        with ThreadPoolExecutor(max_workers=min(len(pending), 9)) as pool:
            futures = {k: pool.submit(_cached_lookup, lat, lng, lookup) for k, (lat, lng) in pending.items()}
            for k, fut in futures.items():
                try:
                    outcomes[k] = fut.result(timeout=LOOKUP_TIMEOUT_S + 2)
                except Exception:  # noqa: BLE001
                    outcomes[k] = (False, None)

    warnings: list[str] = []
    if outcomes and not any(ok for ok, _ in outcomes.values()):
        warnings.append("Route names are unavailable right now; routes are numbered instead.")

    # per route: ordered distinct places (excluding origin / destination cities)
    per_route: list[list[Place]] = []
    for pts in points:
        found: list[tuple[int, Place]] = []  # (index of the sample point, place)
        for i, (lng, lat) in enumerate(pts):
            ok, place = outcomes.get(_key(lat, lng), (False, None))
            if ok and place and place[0].casefold() not in skip and all(p[0] != place[0] for _, p in found):
                found.append((i, place))
        # middle point first, then 25 %, then 75 %; keep the best two in route order
        found.sort(key=lambda t: (t[0] != 1, t[0]))
        chosen = sorted(found[:MAX_PLACES], key=lambda t: t[0])
        per_route.append([p for _, p in chosen])

    labels: list[str | None] = []
    for places in per_route:
        if not places:
            labels.append(None)
        elif len(places) == 1:
            name, region = places[0]
            labels.append(f"Via {name}, {region}" if region else f"Via {name}")
        else:
            labels.append(f"Via {places[0][0]} and {places[1][0]}")

    # make duplicate labels unique
    for label in {l for l in labels if l}:
        idx = [i for i, l in enumerate(labels) if l == label]
        if len(idx) < 2:
            continue
        for i in idx:
            others = {p[0] for j in idx if j != i for p in per_route[j]}
            all_places = {p[0] for p in per_route[i]}
            own = [p[0] for p in _all_places(points[i], outcomes, skip) if p[0] not in others]
            extra = next((n for n in own if n not in all_places), None)
            if extra:
                labels[i] = f"{label} (near {extra})"
            elif len(points[i]) == 3:
                labels[i] = f"{label} ({_side(origin, destination, points[i][1])})"
    # last resort: still equal -> number them
    seen: dict[str, int] = {}
    for i, l in enumerate(labels):
        if l:
            seen[l] = seen.get(l, 0) + 1
            if seen[l] > 1:
                labels[i] = f"{l} {seen[l]}"

    summaries = {r.id: labels[i] or f"Route {i + 1}" for i, r in enumerate(routes)}
    return SummaryResult(summaries, delta_labels(routes), warnings)


def _all_places(pts, outcomes, skip) -> list[Place]:
    out: list[Place] = []
    for lng, lat in pts:
        ok, place = outcomes.get(_key(lat, lng), (False, None))
        if ok and place and place[0].casefold() not in skip and all(p[0] != place[0] for p in out):
            out.append(place)
    return out
