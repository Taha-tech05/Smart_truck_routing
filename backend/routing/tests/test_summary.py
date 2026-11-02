"""Route summaries and delta labels. No network: the reverse lookup is injected or mocked with respx."""
import httpx
import pytest
import respx

from routing.constants import ORS_BASE_URL
from routing.services import summary
from routing.services.summary import RouteInput, build_summaries, delta_labels

ORIGIN = {"lat": 32.78, "lng": -96.8, "label": "Dallas, TX, USA"}
DEST = {"lat": 39.74, "lng": -104.99, "label": "Denver, CO, USA"}


@pytest.fixture(autouse=True)
def _clear(settings):
    settings.ORS_API_KEY = "test-key"
    summary.clear_cache()
    yield
    summary.clear_cache()


def straight(lat0, lng0, lat1, lng1, bulge=0.0, n=40):
    """Polyline [(lng, lat)] with an optional latitude bulge in the middle."""
    out = []
    for i in range(n + 1):
        f = i / n
        out.append((lng0 + (lng1 - lng0) * f, lat0 + (lat1 - lat0) * f + bulge * (1 - abs(2 * f - 1))))
    return out


def route(rid, bulge=0.0, dur=36000):
    return RouteInput(rid, straight(32.78, -96.8, 39.74, -104.99, bulge), dur)


def lookup_by_lat(table):
    """lookup(lat, lng): pick the entry whose latitude band contains lat."""
    def fn(lat, lng):
        for (lo, hi), place in table.items():
            if lo <= lat < hi:
                return place
        return None
    return fn


def test_label_from_two_places():
    table = {(33, 35.5): ("Wichita Falls", "TX"), (35.5, 37.5): ("Amarillo", "TX"), (37.5, 40): ("Pueblo", "CO")}
    out = build_summaries([route("r1")], ORIGIN, DEST, lookup=lookup_by_lat(table))
    # max 2 places: the middle point (Amarillo) and the 25 % point, shown in route order
    assert out.summaries["r1"] == "Via Wichita Falls and Amarillo"
    assert out.warnings == []


def test_single_place_has_region():
    out = build_summaries([route("r1")], ORIGIN, DEST, lookup=lambda lat, lng: ("Amarillo", "TX"))
    assert out.summaries["r1"] == "Via Amarillo, TX"


def test_origin_and_destination_cities_are_skipped():
    def lk(lat, lng):
        if lat < 35:
            return ("Dallas", "TX")
        if lat > 38:
            return ("Denver", "CO")
        return ("Amarillo", "TX")
    out = build_summaries([route("r1")], ORIGIN, DEST, lookup=lk)
    assert out.summaries["r1"] == "Via Amarillo, TX"


def test_duplicate_labels_made_unique_by_differing_place():
    def lk(lat, lng):
        if 36 < lat < 36.6:
            return ("Amarillo", "TX")
        if lat < 35.5:
            return ("Wichita Falls", "TX")
        if lat > 37.5:
            return ("Pueblo", "CO") if lng > -103.4 else ("Trinidad", "CO")
        return None

    a = route("a")
    b = RouteInput("b", [(x - 1.0, y) for x, y in a.coordinates], 36000)
    out = build_summaries([a, b], ORIGIN, DEST, lookup=lk)
    assert out.summaries["a"] == "Via Wichita Falls and Amarillo (near Pueblo)"
    assert out.summaries["b"] == "Via Wichita Falls and Amarillo (near Trinidad)"


def test_duplicate_labels_fall_back_to_side_of_line():
    # east-west trip: one route bulges north, the other south
    o, d = {"lat": 35.0, "lng": -97.0, "label": "A, OK"}, {"lat": 35.0, "lng": -105.0, "label": "B, NM"}
    a = RouteInput("a", straight(35.0, -97.0, 35.0, -105.0, 1.0), 36000)
    b = RouteInput("b", straight(35.0, -97.0, 35.0, -105.0, -1.0), 36000)
    out = build_summaries([a, b], o, d, lookup=lambda lat, lng: ("Amarillo", "TX"))
    assert out.summaries["a"] == "Via Amarillo, TX (north)"
    assert out.summaries["b"] == "Via Amarillo, TX (south)"


def test_failure_falls_back_to_route_n_and_warns_when_all_fail():
    def boom(lat, lng):
        raise RuntimeError("down")
    out = build_summaries([route("a"), route("b", bulge=1)], ORIGIN, DEST, lookup=boom)
    assert out.summaries == {"a": "Route 1", "b": "Route 2"}
    assert len(out.warnings) == 1


def test_no_results_is_not_a_failure():
    out = build_summaries([route("a")], ORIGIN, DEST, lookup=lambda lat, lng: None)
    assert out.summaries == {"a": "Route 1"}
    assert out.warnings == []


def test_partial_failure_no_warning():
    calls = {"n": 0}
    def flaky(lat, lng):
        calls["n"] += 1
        if lat < 35:
            raise RuntimeError("x")
        return ("Amarillo", "TX")
    out = build_summaries([route("a")], ORIGIN, DEST, lookup=flaky)
    assert out.summaries["a"] == "Via Amarillo, TX"
    assert out.warnings == []


def test_lookups_are_cached_by_tenth_degree():
    calls = []
    def lk(lat, lng):
        calls.append((lat, lng))
        return ("Amarillo", "TX")
    build_summaries([route("a")], ORIGIN, DEST, lookup=lk)
    first = len(calls)
    build_summaries([route("a")], ORIGIN, DEST, lookup=lk)
    assert first >= 1 and len(calls) == first


def test_delta_labels():
    out = delta_labels([RouteInput("a", [], 36000), RouteInput("b", [], 36000 + 74 * 60), RouteInput("c", [], 36000 + 20 * 60)])
    assert out == {"a": "Fastest", "b": "+1 h 14 min vs fastest", "c": "+20 min vs fastest"}


@respx.mock
def test_reverse_geocode_request_and_parse():
    r = respx.get(f"{ORS_BASE_URL}/geocode/reverse").mock(return_value=httpx.Response(
        200, json={"features": [{"properties": {"name": "Amarillo", "region_a": "TX"}}]}))
    assert summary.reverse_locality(35.2, -101.8) == ("Amarillo", "TX")
    q = r.calls[0].request.url.params
    assert q["layers"] == "locality" and q["size"] == "1"
    assert q["point.lat"] == "35.2" and q["point.lon"] == "-101.8"


@respx.mock
def test_build_summaries_over_http_never_raises():
    respx.get(f"{ORS_BASE_URL}/geocode/reverse").mock(return_value=httpx.Response(500))
    out = build_summaries([route("a")], ORIGIN, DEST)
    assert out.summaries == {"a": "Route 1"} and out.warnings
