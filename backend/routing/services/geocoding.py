"""Geocoding via the OpenRouteService geocode API (same ORS_API_KEY).

Results are ``{"label", "lat", "lng"}`` dicts, at most 5 per query.
"""
from __future__ import annotations

from .routing_client import RoutingError, ors_request

MAX_RESULTS = 5


class GeocodingError(RoutingError):
    """Base class for geocoding-specific failures."""


class EmptyQueryError(GeocodingError):
    """The search text was empty."""


class NoResultsError(GeocodingError):
    """The query matched no places."""


def _search(path: str, text: str, api_key: str | None) -> list[dict]:
    query = (text or "").strip()
    if not query:
        raise EmptyQueryError("Search text must not be empty")
    data = ors_request(
        "GET", path, api_key=api_key, params={"text": query, "size": MAX_RESULTS}
    )
    results: list[dict] = []
    for feat in data.get("features", []):
        coords = feat.get("geometry", {}).get("coordinates")
        label = feat.get("properties", {}).get("label")
        if not coords or len(coords) < 2 or not label:
            continue
        results.append({"label": label, "lat": float(coords[1]), "lng": float(coords[0])})
    return results[:MAX_RESULTS]


def geocode(text: str, api_key: str | None = None) -> list[dict]:
    """Search for places. Raises EmptyQueryError / NoResultsError / RoutingError."""
    results = _search("/geocode/search", text, api_key)
    if not results:
        raise NoResultsError(f"No places found for {text.strip()!r}")
    return results


def autocomplete(text: str, api_key: str | None = None) -> list[dict]:
    """As-you-type suggestions. Returns an empty list when nothing matches."""
    return _search("/geocode/autocomplete", text, api_key)
