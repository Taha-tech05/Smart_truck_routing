"""Tests for services.routing_client (HTTP mocked with respx; no network)."""
import json

import httpx
import pytest
import respx

from routing.constants import MILES_PER_METER, ORS_BASE_URL
from routing.services import routing_client as rc
from routing.services.checkpoints import haversine_miles

URL = f"{ORS_BASE_URL}/v2/directions/driving-hgv/geojson"
ORIGIN = (40.0, -100.0)  # (lat, lng)
DEST = (41.5, -100.0)
KEY = "test-key"


def feature(coords, mph=55):
    miles = sum(
        haversine_miles(a[1], a[0], b[1], b[0]) for a, b in zip(coords, coords[1:])
    )
    return {
        "type": "Feature",
        "properties": {"summary": {"distance": miles / MILES_PER_METER,
                                   "duration": miles / mph * 3600}},
        "geometry": {"type": "LineString", "coordinates": [list(c) for c in coords]},
    }


def collection(*feats):
    return {"type": "FeatureCollection", "features": list(feats)}


@respx.mock
def test_three_routes_returned_directly(fixture_json):
    route = respx.post(URL).mock(
        return_value=httpx.Response(200, json=fixture_json("ors_directions_3routes.json"))
    )
    res = rc.get_routes(ORIGIN, DEST, api_key=KEY)
    assert route.call_count == 1  # no fallback needed
    assert [r.id for r in res.routes] == ["route-1", "route-2", "route-3"]
    assert res.routes[0].summary == "Fastest"
    assert res.warnings == []
    first = res.routes[0]
    assert first.distance_miles == pytest.approx(103.6, abs=1.0)
    assert first.coordinates[0] == (-100.0, 40.0)
    body = json.loads(route.calls[0].request.content)
    assert body["coordinates"] == [[-100.0, 40.0], [-100.0, 41.5]]
    assert body["alternative_routes"] == {"target_count": 3, "share_factor": 0.6, "weight_factor": 1.6}
    assert route.calls[0].request.headers["Authorization"] == KEY


@respx.mock
def test_fallback_via_waypoints_when_only_one_route(fixture_json):
    one = fixture_json("ors_directions_1route.json")
    calls = []

    def handler(request):
        body = json.loads(request.content)
        calls.append(body)
        if len(body["coordinates"]) == 2:
            return httpx.Response(200, json=one)
        o, via, d = body["coordinates"]
        return httpx.Response(200, json=collection(feature([o, via, d])))

    respx.post(URL).mock(side_effect=handler)
    res = rc.get_routes(ORIGIN, DEST, api_key=KEY)

    assert len(calls) == 3
    vias = [c["coordinates"][1] for c in calls[1:]]
    assert all("alternative_routes" not in c for c in calls[1:])
    # via points are offset east/west of the straight north-south route
    assert min(v[0] for v in vias) < -100.0 < max(v[0] for v in vias)
    # ~10% of ~103.6 miles is ~10 miles (~0.19 deg of longitude at 40.75 N)
    offset = haversine_miles(40.75, -100.0, 40.75, max(v[0] for v in vias))
    assert offset == pytest.approx(10.4, abs=1.5)
    assert len(res.routes) == 3
    assert res.warnings == []


@respx.mock
def test_via_duplicates_removed_and_warning_added(fixture_json):
    one = fixture_json("ors_directions_1route.json")

    def handler(request):
        body = json.loads(request.content)
        if len(body["coordinates"]) == 2:
            return httpx.Response(200, json=one)
        # via routes that just retrace the main route -> duplicates
        return httpx.Response(200, json=one)

    respx.post(URL).mock(side_effect=handler)
    res = rc.get_routes(ORIGIN, DEST, api_key=KEY)
    assert len(res.routes) == 1
    assert any("Only 1 distinct route" in w for w in res.warnings)


@respx.mock
def test_overlong_via_route_discarded(fixture_json):
    one = fixture_json("ors_directions_1route.json")

    def handler(request):
        body = json.loads(request.content)
        if len(body["coordinates"]) == 2:
            return httpx.Response(200, json=one)
        o, _via, d = body["coordinates"]
        far = [o[0] + 4.0, (o[1] + d[1]) / 2]  # huge detour (> 1.5x)
        return httpx.Response(200, json=collection(feature([o, far, d])))

    respx.post(URL).mock(side_effect=handler)
    res = rc.get_routes(ORIGIN, DEST, api_key=KEY)
    assert len(res.routes) == 1
    assert any("longer" in w for w in res.warnings)


@respx.mock
def test_failed_via_request_is_a_warning_not_an_error(fixture_json):
    one = fixture_json("ors_directions_1route.json")

    def handler(request):
        if len(json.loads(request.content)["coordinates"]) == 2:
            return httpx.Response(200, json=one)
        return httpx.Response(404, json={"error": {"code": 2010, "message": "Could not find routable point"}})

    respx.post(URL).mock(side_effect=handler)
    res = rc.get_routes(ORIGIN, DEST, api_key=KEY)
    assert len(res.routes) == 1
    assert sum("Could not build alternative route" in w for w in res.warnings) == 2


@respx.mock
def test_alternatives_rejected_retries_plain(fixture_json):
    one = fixture_json("ors_directions_1route.json")

    def handler(request):
        body = json.loads(request.content)
        if "alternative_routes" in body:
            return httpx.Response(400, json={"error": {"code": 2004, "message": "distance must not be greater than 100000"}})
        if len(body["coordinates"]) == 2:
            return httpx.Response(200, json=one)
        return httpx.Response(200, json=one)

    respx.post(URL).mock(side_effect=handler)
    res = rc.get_routes(ORIGIN, DEST, api_key=KEY)
    assert len(res.routes) == 1
    assert any("not available" in w for w in res.warnings)


def test_dedupe_helper():
    a = [(-100.0, 40.0 + i * 0.1) for i in range(16)]
    near = [(-100.0 + 0.005, 40.0 + i * 0.1) for i in range(16)]   # ~0.26 mi away
    far = [(-100.0 + 0.5, 40.0 + i * 0.1) for i in range(16)]      # ~26 mi away
    assert rc.is_duplicate(a, near)
    assert not rc.is_duplicate(a, far)


@pytest.mark.parametrize(
    "status,exc",
    [
        (401, rc.RoutingAuthError),
        (403, rc.RoutingAuthError),
        (429, rc.RoutingRateLimitError),
        (500, rc.RoutingUpstreamError),
        (503, rc.RoutingUpstreamError),
        (404, rc.NoRouteFoundError),
    ],
)
@respx.mock
def test_http_errors_map_to_exceptions(status, exc):
    respx.post(URL).mock(return_value=httpx.Response(status, json={"error": "x"}))
    with pytest.raises(exc):
        rc.get_routes(ORIGIN, DEST, api_key=KEY)


@respx.mock
def test_rate_limit_is_routing_error():
    respx.post(URL).mock(return_value=httpx.Response(429))
    with pytest.raises(rc.RoutingError):
        rc.get_routes(ORIGIN, DEST, api_key=KEY)


@respx.mock
def test_timeout_maps_to_timeout_error():
    respx.post(URL).mock(side_effect=httpx.ConnectTimeout("slow"))
    with pytest.raises(rc.RoutingTimeoutError):
        rc.get_routes(ORIGIN, DEST, api_key=KEY)


@respx.mock
def test_network_error_maps_to_upstream_error():
    respx.post(URL).mock(side_effect=httpx.ConnectError("down"))
    with pytest.raises(rc.RoutingUpstreamError):
        rc.get_routes(ORIGIN, DEST, api_key=KEY)


@respx.mock
def test_no_features_raises_no_route():
    respx.post(URL).mock(return_value=httpx.Response(200, json=collection()))
    with pytest.raises(rc.NoRouteFoundError):
        rc.get_routes(ORIGIN, DEST, api_key=KEY)


def test_missing_api_key_raises(settings):
    settings.ORS_API_KEY = ""
    with pytest.raises(rc.RoutingAuthError):
        rc.get_routes(ORIGIN, DEST)
