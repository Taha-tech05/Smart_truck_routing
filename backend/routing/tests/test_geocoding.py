"""Tests for services.geocoding (HTTP mocked)."""
import httpx
import pytest
import respx

from routing.constants import ORS_BASE_URL
from routing.services import geocoding as g
from routing.services.routing_client import RoutingAuthError, RoutingUpstreamError

SEARCH = f"{ORS_BASE_URL}/geocode/search"
AUTO = f"{ORS_BASE_URL}/geocode/autocomplete"


@respx.mock
def test_geocode_parses_results(fixture_json):
    route = respx.get(SEARCH).mock(return_value=httpx.Response(200, json=fixture_json("ors_geocode.json")))
    out = g.geocode("Omaha", api_key="k")
    assert out[0] == {"label": "Omaha, NE, USA", "lat": 41.26, "lng": -95.93}
    assert len(out) == 2
    req = route.calls[0].request
    assert req.url.params["text"] == "Omaha" and req.url.params["size"] == "5"


@respx.mock
def test_geocode_caps_at_five():
    feats = [{"properties": {"label": f"P{i}"}, "geometry": {"coordinates": [i, i]}} for i in range(9)]
    respx.get(SEARCH).mock(return_value=httpx.Response(200, json={"features": feats}))
    assert len(g.geocode("x", api_key="k")) == 5


@respx.mock
def test_geocode_no_results_raises(fixture_json):
    respx.get(SEARCH).mock(return_value=httpx.Response(200, json=fixture_json("ors_geocode_empty.json")))
    with pytest.raises(g.NoResultsError):
        g.geocode("zzzz", api_key="k")


@pytest.mark.parametrize("text", ["", "   ", None])
def test_empty_input_raises(text):
    with pytest.raises(g.EmptyQueryError):
        g.geocode(text, api_key="k")
    with pytest.raises(g.EmptyQueryError):
        g.autocomplete(text, api_key="k")


@respx.mock
def test_autocomplete_uses_autocomplete_endpoint(fixture_json):
    route = respx.get(AUTO).mock(return_value=httpx.Response(200, json=fixture_json("ors_geocode.json")))
    assert len(g.autocomplete("Oma", api_key="k")) == 2
    assert route.called


@respx.mock
def test_autocomplete_empty_returns_empty_list(fixture_json):
    respx.get(AUTO).mock(return_value=httpx.Response(200, json=fixture_json("ors_geocode_empty.json")))
    assert g.autocomplete("zzz", api_key="k") == []


@respx.mock
def test_upstream_failures():
    respx.get(SEARCH).mock(return_value=httpx.Response(502))
    with pytest.raises(RoutingUpstreamError):
        g.geocode("x", api_key="k")
    respx.get(SEARCH).mock(return_value=httpx.Response(403))
    with pytest.raises(RoutingAuthError):
        g.geocode("x", api_key="k")
