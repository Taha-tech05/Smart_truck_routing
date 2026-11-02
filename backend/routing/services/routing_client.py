"""OpenRouteService directions client (profile ``driving-hgv``, GeoJSON output).

All HTTP for directions lives here. Coordinates in public APIs are
``(lat, lng)`` for origin/destination and ``(lng, lat)`` (GeoJSON order) for
route geometry. Units are converted to miles at this boundary.

ORS alternative routes
----------------------
The public ORS API only supports ``alternative_routes`` for routes up to
roughly 100 km, and long truck trips often return a single route (or a 400
error for the alternatives request). ``get_routes`` therefore:

1. asks for alternatives (target_count=3, share_factor=0.6, weight_factor=1.6);
   if ORS rejects that request it retries a plain request;
2. if fewer than 3 distinct routes came back, builds *via* waypoints at the
   midpoint of the main route, offset perpendicular to the route direction by
   ~10% of the route length (once to each side), and requests
   origin -> via -> destination for each;
3. de-duplicates (two routes are the same if > 90% of their sampled points lie
   within 1 mile of the other) and discards via-routes more than 1.5x longer
   (by distance) than the fastest route.

It never fails just because fewer than 3 routes exist; instead it returns what
it found plus a ``warnings`` list.
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import httpx

from ..constants import (
    EARTH_RADIUS_MILES,
    HTTP_TIMEOUT_S,
    MILES_PER_METER,
    ORS_BASE_URL,
)
from .checkpoints import (
    Coord,
    cumulative_miles,
    interpolate_at,
    local_direction,
    offset_point,
)

PROFILE = "driving-hgv"
MAX_ROUTES = 3
ALTERNATIVE_ROUTES = {"target_count": 3, "share_factor": 0.6, "weight_factor": 1.6}
VIA_OFFSET_FRACTION = 0.10
ENDPOINT_SNAP_RADIUS_M = 350  # ORS default snap radius for origin/destination
VIA_SNAP_RADIUS_M = 5000  # via points are synthetic, so let them snap further
MAX_VIA_LENGTH_RATIO = 1.5
DUPLICATE_RADIUS_MILES = 1.0
DUPLICATE_FRACTION = 0.9
SAMPLE_POINTS = 40


# ---------------------------------------------------------------- errors

class RoutingError(Exception):
    """Base class for all ORS routing/geocoding failures."""


class RoutingAuthError(RoutingError):
    """401/403: the ORS API key is missing or invalid."""


class RoutingRateLimitError(RoutingError):
    """429: ORS rate limit or quota exceeded."""


class RoutingUpstreamError(RoutingError):
    """5xx or network failure talking to ORS."""


class RoutingTimeoutError(RoutingError):
    """ORS did not answer within the timeout."""


class NoRouteFoundError(RoutingError):
    """ORS could not find a route (400/404, e.g. unroutable point)."""


# ---------------------------------------------------------------- types

@dataclass(frozen=True)
class RouteOption:
    id: str
    summary: str
    distance_miles: float
    duration_s: float
    coordinates: list[Coord]  # (lng, lat)


@dataclass
class RoutesResult:
    routes: list[RouteOption]
    warnings: list[str] = field(default_factory=list)


# ---------------------------------------------------------------- HTTP

def _api_key(api_key: str | None) -> str:
    if api_key is None:
        from django.conf import settings

        api_key = getattr(settings, "ORS_API_KEY", "")
    if not api_key:
        raise RoutingAuthError("ORS_API_KEY is not configured")
    return api_key


_client: httpx.Client | None = None


def _get_client() -> httpx.Client:
    """Shared client: building an SSL context per request is slow on Windows."""
    global _client
    if _client is None:
        _client = httpx.Client(timeout=HTTP_TIMEOUT_S)
    return _client


def ors_request(
    method: str,
    path: str,
    *,
    api_key: str | None = None,
    params: dict | None = None,
    json: dict | None = None,
    base_url: str = ORS_BASE_URL,
) -> dict:
    """Perform an ORS request and map failures to RoutingError subclasses."""
    headers = {"Authorization": _api_key(api_key)}
    try:
        resp = _get_client().request(
            method,
            f"{base_url}{path}",
            params=params,
            json=json,
            headers=headers,
            timeout=HTTP_TIMEOUT_S,
        )
    except httpx.TimeoutException as exc:
        raise RoutingTimeoutError("OpenRouteService timed out") from exc
    except httpx.HTTPError as exc:
        raise RoutingUpstreamError(f"Could not reach OpenRouteService: {exc}") from exc

    status = resp.status_code
    if status in (401, 403):
        raise RoutingAuthError("OpenRouteService rejected the API key")
    if status == 429:
        raise RoutingRateLimitError("OpenRouteService rate limit exceeded")
    if status >= 500:
        raise RoutingUpstreamError(f"OpenRouteService error ({status})")
    if status >= 400:
        raise NoRouteFoundError(_error_message(resp) or f"Request rejected ({status})")
    try:
        return resp.json()
    except ValueError as exc:
        raise RoutingUpstreamError("OpenRouteService returned invalid JSON") from exc


def _error_message(resp: httpx.Response) -> str:
    try:
        err = resp.json().get("error")
    except ValueError:
        return ""
    if isinstance(err, dict):
        return str(err.get("message", ""))
    return str(err or "")


# ---------------------------------------------------------------- geometry helpers

def via_points(coordinates: list[Coord]) -> list[Coord]:
    """Two via points: route midpoint offset ~10% of length to each side."""
    cum = cumulative_miles(coordinates)
    length = cum[-1]
    mid = interpolate_at(coordinates, cum, length / 2)
    east, north = local_direction(coordinates, cum, length / 2)
    perp = (-north, east)
    off = length * VIA_OFFSET_FRACTION
    return [
        offset_point(mid[0], mid[1], perp, off),
        offset_point(mid[0], mid[1], (-perp[0], -perp[1]), off),
    ]


def _dist_point_to_segment_miles(p: Coord, a: Coord, b: Coord) -> float:
    """Distance (miles) from p to segment a-b using a local flat projection."""
    k = math.radians(1) * EARTH_RADIUS_MILES
    coslat = math.cos(math.radians(p[1]))
    ax, ay = (a[0] - p[0]) * coslat * k, (a[1] - p[1]) * k
    bx, by = (b[0] - p[0]) * coslat * k, (b[1] - p[1]) * k
    dx, dy = bx - ax, by - ay
    seg2 = dx * dx + dy * dy
    t = 0.0 if seg2 == 0 else max(0.0, min(1.0, -(ax * dx + ay * dy) / seg2))
    return math.hypot(ax + t * dx, ay + t * dy)


_CELL_DEG = 0.05  # ~3.5 mi: wider than the 1-mile duplicate radius


class _Poly:
    """A polyline prepared for fast sampling and nearest-segment queries.

    Cumulative lengths give O(log n) sampling; a coarse grid of segment indices
    limits distance checks to segments near the query point (a naive scan of
    ~6,000 segments per sample point made long routes take seconds).
    """

    def __init__(self, coords: list[Coord]):
        self.coords = coords
        self.cum = cumulative_miles(coords)
        self.length = self.cum[-1]
        self.grid: dict[tuple[int, int], list[int]] = {}
        for i, (a, b) in enumerate(zip(coords, coords[1:])):
            x0, x1 = sorted((math.floor(a[0] / _CELL_DEG), math.floor(b[0] / _CELL_DEG)))
            y0, y1 = sorted((math.floor(a[1] / _CELL_DEG), math.floor(b[1] / _CELL_DEG)))
            for cx in range(x0, x1 + 1):
                for cy in range(y0, y1 + 1):
                    self.grid.setdefault((cx, cy), []).append(i)

    def samples(self, n: int = SAMPLE_POINTS) -> list[Coord]:
        if self.length == 0:
            return [self.coords[0]]
        return [interpolate_at(self.coords, self.cum, self.length * i / (n - 1)) for i in range(n)]

    def is_near(self, p: Coord, radius_miles: float) -> bool:
        cx, cy = math.floor(p[0] / _CELL_DEG), math.floor(p[1] / _CELL_DEG)
        seen: set[int] = set()
        for dx in (-1, 0, 1):
            for dy in (-1, 0, 1):
                for i in self.grid.get((cx + dx, cy + dy), ()):
                    if i in seen:
                        continue
                    seen.add(i)
                    if _dist_point_to_segment_miles(p, self.coords[i], self.coords[i + 1]) <= radius_miles:
                        return True
        return False


def _fraction_near(a: _Poly, b: _Poly) -> float:
    """Fraction of sampled points of ``a`` within 1 mile of polyline ``b``."""
    pts = a.samples()
    return sum(1 for p in pts if b.is_near(p, DUPLICATE_RADIUS_MILES)) / len(pts)


def _poly_duplicate(a: _Poly, b: _Poly) -> bool:
    return _fraction_near(a, b) > DUPLICATE_FRACTION and _fraction_near(b, a) > DUPLICATE_FRACTION


def is_duplicate(a: list[Coord], b: list[Coord]) -> bool:
    """True if >90% of each route's sampled points lie within 1 mile of the other."""
    return _poly_duplicate(_Poly(a), _Poly(b))


# ---------------------------------------------------------------- parsing

def _parse_features(data: dict) -> list[tuple[float, float, list[Coord]]]:
    """Return ``[(distance_miles, duration_s, coords), ...]`` from an ORS GeoJSON response."""
    out = []
    for feat in data.get("features", []):
        summary = feat.get("properties", {}).get("summary", {})
        coords = [(float(c[0]), float(c[1])) for c in feat.get("geometry", {}).get("coordinates", [])]
        if len(coords) < 2:
            continue
        out.append(
            (
                float(summary.get("distance", 0)) * MILES_PER_METER,
                float(summary.get("duration", 0)),
                coords,
            )
        )
    return out


def _directions(
    coordinates: list[list[float]],
    api_key: str | None,
    alternatives: bool,
    radiuses: list[int] | None = None,
) -> list[tuple[float, float, list[Coord]]]:
    body: dict = {"coordinates": coordinates}
    if radiuses is not None:
        if len(radiuses) != len(coordinates):
            raise ValueError("radiuses needs one entry per waypoint")
        body["radiuses"] = radiuses
    if alternatives:
        body["alternative_routes"] = ALTERNATIVE_ROUTES
    data = ors_request(
        "POST", f"/v2/directions/{PROFILE}/geojson", api_key=api_key, json=body
    )
    return _parse_features(data)


def _fmt_duration(seconds: float) -> str:
    minutes = round(seconds / 60)
    h, m = divmod(abs(minutes), 60)
    return f"{h} h {m} min" if h else f"{m} min"


def _label(i: int, base: tuple[float, float, list[Coord]], cur: tuple[float, float, list[Coord]]) -> str:
    if i == 0:
        return "Fastest"
    extra_min = round((cur[1] - base[1]) / 60)
    sign = "+" if extra_min >= 0 else "-"
    return f"Alternative {i} ({sign}{_fmt_duration(abs(cur[1] - base[1]))}, {cur[0]:.0f} mi)"


# ---------------------------------------------------------------- public API

def get_routes(
    origin: tuple[float, float],
    destination: tuple[float, float],
    api_key: str | None = None,
) -> RoutesResult:
    """Return up to 3 distinct truck routes from ``origin`` to ``destination``.

    ``origin`` / ``destination`` are ``(lat, lng)``. Raises a RoutingError
    subclass if the main request fails; failures of the extra via-route
    requests only produce warnings.
    """
    warnings: list[str] = []
    no_alternatives_msg: str | None = None
    o = [origin[1], origin[0]]
    d = [destination[1], destination[0]]

    try:
        found = _directions([o, d], api_key, alternatives=True)
    except NoRouteFoundError:
        # e.g. route too long for the alternatives algorithm: retry plain.
        found = _directions([o, d], api_key, alternatives=False)
        no_alternatives_msg = "Alternative routes are not available for this trip length."
        warnings.append(no_alternatives_msg)
    if not found:
        raise NoRouteFoundError("No route found between the given points")

    candidates: list[tuple[float, float, list[Coord]]] = []
    via_candidates: list[tuple[float, float, list[Coord]]] = []

    polys: dict[int, _Poly] = {}  # prepared polylines, keyed by the coords list identity

    def poly(item: tuple[float, float, list[Coord]]) -> _Poly:
        return polys.setdefault(id(item[2]), _Poly(item[2]))

    def distinct(items: list[tuple[float, float, list[Coord]]]) -> list:
        kept: list = []
        for item in sorted(items, key=lambda r: r[1]):
            if not any(_poly_duplicate(poly(item), poly(k)) for k in kept):
                kept.append(item)
        return kept

    candidates = distinct(found)

    if len(candidates) < MAX_ROUTES:
        main = candidates[0]
        for n, via in enumerate(via_points(main[2]), start=1):
            try:
                got = _directions(
                    [o, [via[0], via[1]], d],
                    api_key,
                    alternatives=False,
                    radiuses=[ENDPOINT_SNAP_RADIUS_M, VIA_SNAP_RADIUS_M, ENDPOINT_SNAP_RADIUS_M],
                )
            except (NoRouteFoundError, RoutingRateLimitError, RoutingUpstreamError,
                    RoutingTimeoutError) as exc:
                warnings.append(f"Could not build alternative route {n}: {exc}")
                continue
            via_candidates.extend(got[:1])

        fastest_distance = min(c[0] for c in candidates)
        for v in via_candidates:
            if v[0] > MAX_VIA_LENGTH_RATIO * fastest_distance:
                warnings.append("Discarded an alternative route that was much longer than the fastest.")
                continue
            candidates = distinct(candidates + [v])

    candidates = sorted(candidates, key=lambda r: r[1])[:MAX_ROUTES]
    if no_alternatives_msg and len(candidates) > 1:
        # the via-point search did find alternatives, so the warning would be misleading
        warnings.remove(no_alternatives_msg)
    if len(candidates) < MAX_ROUTES:
        warnings.append(
            f"Only {len(candidates)} distinct route{'s' if len(candidates) != 1 else ''} found."
        )

    base = candidates[0]
    routes = [
        RouteOption(
            id=f"route-{i + 1}",
            summary=_label(i, base, c),
            distance_miles=c[0],
            duration_s=c[1],
            coordinates=c[2],
        )
        for i, c in enumerate(candidates)
    ]
    return RoutesResult(routes=routes, warnings=warnings)
