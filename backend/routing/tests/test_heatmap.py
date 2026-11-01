"""Tests for services.heatmap and POST /api/heatmap (all HTTP mocked)."""
import json
import math
from datetime import datetime, timedelta, timezone

import httpx
import pytest
import respx
from rest_framework.test import APIClient

from routing.constants import EARTH_RADIUS_MILES, OPEN_METEO_BASE_URL
from routing.services import heatmap, weather_client
from routing.services.checkpoints import haversine_miles

UTC = timezone.utc
DEG_PER_MILE = math.degrees(1 / EARTH_RADIUS_MILES)
FORECAST_START = datetime(2026, 11, 2, 0, 0)  # Open-Meteo arrays start at 00:00 UTC
NOW = datetime(2026, 11, 2, 13, 40, tzinfo=UTC)


def line(miles: float, parts: int = 10, lng: float = -100.0, lat0: float = 35.0):
    """Straight north-south line of ``miles`` as (lng, lat)."""
    return [(lng, lat0 + DEG_PER_MILE * miles * i / parts) for i in range(parts + 1)]


@pytest.fixture(autouse=True)
def _clean_cache():
    weather_client.clear_cache()
    yield
    weather_client.clear_cache()


def mock_weather(fn=None):
    """Open-Meteo mock. ``fn(lat, lng, hour_index) -> (wind, rain, snow)`` or None=missing."""
    fn = fn or (lambda lat, lng, i: (5.0, 0.0, 0.0))
    times = [(FORECAST_START + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(72)]

    def handler(request):
        lats = [float(x) for x in request.url.params["latitude"].split(",")]
        lngs = [float(x) for x in request.url.params["longitude"].split(",")]
        body = []
        for la, lo in zip(lats, lngs):
            vals = [fn(la, lo, i) for i in range(72)]
            body.append({"hourly": {
                "time": times,
                "wind_speed_10m": [None if v is None else v[0] for v in vals],
                "rain": [0.0 if v is None else v[1] for v in vals],
                "snowfall": [0.0 if v is None else v[2] for v in vals],
            }})
        return httpx.Response(200, json=body if len(body) > 1 else body[0])

    return respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)


# ------------------------------------------------------------------ grid

def test_grid_100_mile_line():
    grid, warnings = heatmap.build_corridor_grid(line(100), 25, 30)
    assert warnings == []
    assert len(grid) == 25  # 5 centre points x 5 offsets, nothing close enough to dedupe
    assert sorted({g.mile_along for g in grid}) == pytest.approx([0, 25, 50, 75, 100])
    assert sorted({g.offset_miles for g in grid}) == pytest.approx([-30, -15, 0, 15, 30])


def test_grid_offsets_are_perpendicular():
    grid, _ = heatmap.build_corridor_grid(line(100), 25, 30)
    for g in grid:
        centre_lat = 35.0 + DEG_PER_MILE * g.mile_along
        # N-S route: perpendicular offsets keep latitude and move only east/west
        assert g.lat == pytest.approx(centre_lat, abs=1e-6)
        dist_from_line = haversine_miles(g.lat, g.lng, g.lat, -100.0)
        assert dist_from_line == pytest.approx(abs(g.offset_miles), abs=0.3)


def test_grid_perpendicular_on_diagonal_route():
    coords = [(-100.0 + 0.02 * i, 35.0 + 0.02 * i) for i in range(101)]  # runs north-east
    grid, _ = heatmap.build_corridor_grid(coords, 25, 30)
    centres = {g.mile_along: g for g in grid if g.offset_miles == 0}
    for g in grid:
        if g.offset_miles == 0:
            continue
        c = centres[g.mile_along]
        # offset point is exactly |offset| from the centre point...
        assert haversine_miles(c.lat, c.lng, g.lat, g.lng) == pytest.approx(abs(g.offset_miles), rel=0.02)
        # ...and the displacement is at right angles to the route heading. The route
        # steps 0.02 deg in both lng and lat, i.e. heading (cos(lat), 1) in local miles.
        cos = math.cos(math.radians(c.lat))
        de = (g.lng - c.lng) * cos
        dn = g.lat - c.lat
        dot = de * cos + dn * 1.0
        assert dot == pytest.approx(0, abs=1e-3 * math.hypot(de, dn))


def test_grid_dedupes_close_points():
    grid, _ = heatmap.build_corridor_grid(line(100), 25, 10)  # offsets +-5 are < 7 mi from centre
    assert len(grid) == 15  # 5 centres x (centre, -10, +10)
    assert not any(abs(g.offset_miles) == 5 for g in grid)


def test_grid_cap_for_2000_mile_route_adds_warning():
    grid, warnings = heatmap.build_corridor_grid(line(2000, parts=200, lat0=10.0), 25, 60)
    assert 0 < len(grid) <= 150
    assert len(warnings) == 1 and "spacing increased" in warnings[0]


def test_grid_invalid_inputs():
    with pytest.raises(ValueError):
        heatmap.build_corridor_grid([(0, 0)], 25, 30)
    with pytest.raises(ValueError):
        heatmap.build_corridor_grid([(0, 0), (0, 0)], 25, 30)
    with pytest.raises(ValueError):
        heatmap.build_corridor_grid(line(10), 0, 30)


def test_simplify_keeps_ends_and_limit():
    coords = [(i * 0.001, i * 0.001) for i in range(12000)]
    out = heatmap.simplify(coords, 5000)
    assert len(out) == 5000 and out[0] == coords[0] and out[-1] == coords[-1]
    assert heatmap.simplify(coords[:10], 5000) == coords[:10]


# ------------------------------------------------------------------ hours / levels

@respx.mock
def test_hour_alignment_with_now_1340():
    def fn(lat, lng, i):
        if i == 13:   # 13:00 on day 0 == hour 0
            return (30.0, 0, 0)   # MODERATE (1)
        if i == 61:   # 13:00 two days later == hour 48
            return (40.0, 0, 0)   # HIGH (2)
        return (5.0, 0, 0)        # LOW (0)

    mock_weather(fn)
    out = heatmap.build_heatmap(line(50), 10000, 30, 25, now=NOW)
    assert out["start_time"] == "2026-11-02T13:00:00Z"
    assert out["hours"] == 49
    for s in out["levels"]:
        assert s[0] == "1"
        assert s[48] == "2"
        assert set(s[1:48]) == {"0"}


@respx.mock
def test_levels_string_shape():
    mock_weather(lambda la, lo, i: (i % 60, (i % 5) * 0.3, (i % 4) * 0.8))
    out = heatmap.build_heatmap(line(100), 30000, 30, 25, now=NOW)
    assert len(out["levels"]) == len(out["points"])
    for s in out["levels"]:
        assert len(s) == 49 and set(s) <= set("01234")
    assert out["level_names"] == ["Low", "Moderate", "High", "Severe", "No Travel"]
    assert len(out["summary"]) == 49
    for h, row in enumerate(out["summary"]):
        assert row["hour"] == h and sum(row["counts"]) == len(out["points"])
        assert row["max_level"] == max(int(s[h]) for s in out["levels"])
    assert all(len(p) == 3 for p in out["points"])


@respx.mock
def test_heavy_load_raises_levels():
    mock_weather(lambda la, lo, i: (40.0, 0, 0))  # 35-44 mph -> HIGH base
    light = heatmap.build_heatmap(line(50), 20000, 30, 25, now=NOW)
    weather_client.clear_cache()
    heavy = heatmap.build_heatmap(line(50), 45000, 30, 25, now=NOW)
    assert all(set(s) == {"2"} for s in light["levels"])
    assert all(set(s) == {"3"} for s in heavy["levels"])  # SEVERE


@respx.mock
def test_missing_hours_forward_filled_and_counted():
    now = datetime(2026, 11, 2, 0, 30, tzinfo=UTC)  # hour 0 == array index 0

    def fn(lat, lng, i):
        if i == 0:
            return None            # no previous hour -> 0
        if i in (20, 21):
            return None            # forward-filled from hour 19
        return (40.0, 0, 0) if i == 19 else (5.0, 0, 0)

    mock_weather(fn)
    out = heatmap.build_heatmap(line(50), 10000, 30, 25, now=now)
    n = len(out["points"])
    for s in out["levels"]:
        assert s[0] == "0"
        assert s[19] == "2" and s[20] == "2" and s[21] == "2"
        assert s[22] == "0"
    assert out["missing"] == 3 * n
    assert any("missing" in w for w in out["warnings"])


@respx.mock
def test_hours_beyond_forecast_array_are_missing():
    now = datetime(2026, 11, 3, 13, 10, tzinfo=UTC)  # hour 48 -> index 85 > 71
    mock_weather()
    out = heatmap.build_heatmap(line(50), 10000, 30, 25, now=now)
    # forecast covers up to 2026-11-04T23:00 -> hours 0..34 present, 35..48 missing
    assert out["missing"] == 14 * len(out["points"])


@respx.mock
def test_cache_shared_with_analyze_flow():
    route = mock_weather()
    coords = line(100)
    grid, _ = heatmap.build_corridor_grid(coords, 25, 30)
    centre = [(g.lat, g.lng) for g in grid if g.offset_miles == 0]
    # what the analyze endpoint would have fetched for these centre-line points
    weather_client.get_hourly_weather(centre)
    before = route.call_count
    heatmap.build_heatmap(coords, 10000, 30, 25, now=NOW)
    requested = sum(len(c.request.url.params["latitude"].split(",")) for c in route.calls[before:])
    assert requested == len({weather_client.cache_key((g.lat, g.lng)) for g in grid}) - len(
        {weather_client.cache_key(p) for p in centre}
    )
    # repeating the heatmap needs no HTTP at all
    calls = route.call_count
    heatmap.build_heatmap(coords, 50000, 30, 25, now=NOW)
    assert route.call_count == calls


@respx.mock
def test_chunked_into_multiple_requests_for_150_points():
    route = mock_weather()
    out = heatmap.build_heatmap(line(2000, parts=200, lat0=10.0), 10000, 60, 25, now=NOW)
    assert len(out["points"]) <= 150
    cells = {weather_client.cache_key((p[0], p[1])) for p in out["points"]}
    assert route.call_count == math.ceil(len(cells) / 50) >= 2  # chunked at 50 points


@respx.mock
def test_response_under_100kb_for_150_points():
    mock_weather(lambda la, lo, i: (i % 60, 0.0, 0.0))
    # a 700-mile route at 10-mile spacing produces more than 150 grid points -> capped
    out = heatmap.build_heatmap(line(700, parts=70, lat0=25.0), 40000, 60, 10, now=NOW)
    n = len(out["points"])
    assert 100 <= n <= 150
    size = len(json.dumps(out))
    assert size < 100_000, size


def test_naive_now_rejected():
    with pytest.raises(ValueError):
        heatmap.build_heatmap(line(10), 1000, 30, 25, now=datetime(2026, 1, 1))


# ------------------------------------------------------------------ view

client = APIClient()


def body(**over):
    data = {"route_coordinates": [[-100.0, 35.0], [-100.0, 36.0]], "load_weight_lb": 40000}
    data.update(over)
    return data


@pytest.mark.parametrize(
    "over,field",
    [
        ({"route_coordinates": [[-100.0, 35.0]]}, "route_coordinates"),
        ({"route_coordinates": "nope"}, "route_coordinates"),
        ({"route_coordinates": [[-100.0, 35.0], [-100.0]]}, "route_coordinates"),
        ({"route_coordinates": [[-100.0, 35.0], [-200.0, 36.0]]}, "route_coordinates"),
        ({"route_coordinates": [[-100.0, 35.0], [-100.0, 95.0]]}, "route_coordinates"),
        ({"route_coordinates": [[-100.0, 35.0], ["a", "b"]]}, "route_coordinates"),
        ({"load_weight_lb": -1}, "load_weight_lb"),
        ({"load_weight_lb": 120001}, "load_weight_lb"),
        ({"corridor_miles": 5}, "corridor_miles"),
        ({"corridor_miles": 61}, "corridor_miles"),
        ({"spacing_miles": 20}, "spacing_miles"),
    ],
)
def test_view_validation_errors(over, field):
    r = client.post("/api/heatmap", body(**over), format="json")
    assert r.status_code == 400
    err = r.json()["error"]
    assert err["code"] == "validation_error" and field in err["message"]


def test_view_zero_length_route_is_400():
    r = client.post("/api/heatmap", body(route_coordinates=[[-100, 35], [-100, 35]]), format="json")
    assert r.status_code == 400 and r.json()["error"]["code"] == "validation_error"


def test_view_missing_load():
    r = client.post("/api/heatmap", {"route_coordinates": [[0, 0], [1, 1]]}, format="json")
    assert r.status_code == 400


@respx.mock
def test_view_success_path_with_defaults(monkeypatch):
    from routing import views

    real = heatmap.build_heatmap
    monkeypatch.setattr(views, "build_heatmap", lambda **kw: real(now=NOW, **kw))
    mock_weather(lambda la, lo, i: (40.0, 0, 0))
    r = client.post("/api/heatmap", body(load_weight_lb=45000), format="json")
    assert r.status_code == 200
    data = r.json()
    assert data["hours"] == 49 and len(data["levels"]) == len(data["points"]) > 0
    assert all(len(s) == 49 for s in data["levels"])
    assert set("".join(data["levels"])) == {"3"}  # wind 40 + 45,000 lb -> Severe
    assert datetime.strptime(data["start_time"], "%Y-%m-%dT%H:%M:%SZ")


@respx.mock
def test_view_large_geometry_is_simplified_not_rejected():
    mock_weather()
    coords = [[-100.0, 35.0 + i * 0.00005] for i in range(7000)]  # > 5000 vertices
    r = client.post("/api/heatmap", body(route_coordinates=coords), format="json")
    assert r.status_code == 200


@respx.mock
def test_view_weather_failure_is_502():
    respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(400, json={"reason": "bad"}))
    r = client.post("/api/heatmap", body(), format="json")
    assert r.status_code == 502
    assert r.json()["error"]["code"] == "weather_unavailable"
