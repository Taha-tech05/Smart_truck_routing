"""View tests via DRF APIClient with services mocked."""
from datetime import timedelta

import pytest
from django.utils import timezone
from rest_framework.test import APIClient

from routing import views
from routing.services import geocoding
from routing.services.routing_client import (
    NoRouteFoundError,
    RoutingAuthError,
    RoutingRateLimitError,
    RoutingUpstreamError,
)
from routing.services.weather_client import WeatherError

client = APIClient()


def body(**over):
    data = {
        "origin": {"lat": 40.0, "lng": -100.0, "label": "A"},
        "destination": {"lat": 41.5, "lng": -100.0, "label": "B"},
        "departure_time": (timezone.now() + timedelta(hours=2)).isoformat(),
        "load_weight_lb": 40000,
        "interval_miles": 25,
    }
    data.update(over)
    return data


def test_health():
    r = client.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_analyze_success_passes_validated_args(monkeypatch):
    seen = {}

    def fake(**kw):
        seen.update(kw)
        return {"routes": [], "recommendation": {"route_id": "route-1", "explanation": "x",
                                                 "all_unsafe": False}, "warnings": []}

    monkeypatch.setattr(views, "analyze_trip", fake)
    r = client.post("/api/analyze", body(), format="json")
    assert r.status_code == 200
    assert r.json()["recommendation"]["route_id"] == "route-1"
    assert seen["load_lb"] == 40000 and seen["interval_miles"] == 25
    assert seen["origin"]["lat"] == 40.0
    assert seen["departure"].utcoffset() is not None


def test_analyze_validation_error_format():
    r = client.post("/api/analyze", body(interval_miles=20), format="json")
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "validation_error"
    assert "interval_miles" in err["message"]


def test_analyze_missing_fields():
    r = client.post("/api/analyze", {}, format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"


@pytest.mark.parametrize(
    "exc,status,code",
    [
        (RoutingRateLimitError("slow down"), 429, "rate_limited"),
        (RoutingUpstreamError("down"), 502, "routing_unavailable"),
        (RoutingAuthError("bad key"), 502, "routing_auth_failed"),
        (WeatherError("no weather"), 502, "weather_unavailable"),
        (NoRouteFoundError("nope"), 400, "no_route"),
    ],
)
def test_upstream_errors_mapped(monkeypatch, exc, status, code):
    def boom(**kw):
        raise exc

    monkeypatch.setattr(views, "analyze_trip", boom)
    r = client.post("/api/analyze", body(), format="json")
    assert r.status_code == status
    assert r.json() == {"error": {"code": code, "message": str(exc)}}


def test_geocode_success(monkeypatch):
    monkeypatch.setattr(
        geocoding, "autocomplete",
        lambda q: [{"label": "Omaha", "lat": 41.2, "lng": -95.9}] if q == "Oma" else [],
    )
    r = client.get("/api/geocode", {"q": "Oma"})
    assert r.status_code == 200 and r.json()[0]["label"] == "Omaha"


def test_geocode_empty_query_is_400():
    r = client.get("/api/geocode")
    assert r.status_code == 400 and r.json()["error"]["code"] == "empty_query"


def test_geocode_upstream_failure(monkeypatch):
    def boom(q):
        raise RoutingUpstreamError("ORS down")

    monkeypatch.setattr(geocoding, "autocomplete", boom)
    r = client.get("/api/geocode", {"q": "x"})
    assert r.status_code == 502


def test_cors_restricted_to_configured_origins():
    ok = client.get("/api/health", HTTP_ORIGIN="http://localhost:5173")
    assert ok["Access-Control-Allow-Origin"] == "http://localhost:5173"
    bad = client.get("/api/health", HTTP_ORIGIN="http://evil.example")
    assert "Access-Control-Allow-Origin" not in bad
