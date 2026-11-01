"""End-to-end tests of services.analysis with ORS and Open-Meteo mocked (respx)."""
from datetime import datetime, timezone

import httpx
import pytest
import respx

from routing.constants import ORS_BASE_URL, OPEN_METEO_BASE_URL
from routing.services import analysis, weather_client

DIRECTIONS = f"{ORS_BASE_URL}/v2/directions/driving-hgv/geojson"
ORIGIN = {"lat": 40.0, "lng": -100.0, "label": "A"}
DEST = {"lat": 41.5, "lng": -100.0, "label": "B"}
DEPARTURE = datetime(2026, 11, 2, 8, 0, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def _env(settings):
    settings.ORS_API_KEY = "test-key"
    weather_client.clear_cache()
    yield
    weather_client.clear_cache()


def mock_weather(wind_for):
    """Open-Meteo mock: wind_for(lat, lng) -> mph; no precipitation."""
    from datetime import timedelta

    base = datetime(2026, 11, 2, 0, 0)
    times = [(base + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(72)]

    def handler(request):
        lats = [float(x) for x in request.url.params["latitude"].split(",")]
        lngs = [float(x) for x in request.url.params["longitude"].split(",")]
        body = [
            {"hourly": {"time": times, "wind_speed_10m": [wind_for(la, lo)] * 72,
                        "rain": [0.0] * 72, "snowfall": [0.0] * 72}}
            for la, lo in zip(lats, lngs)
        ]
        return httpx.Response(200, json=body if len(body) > 1 else body[0])

    return respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)


@respx.mock
def test_end_to_end_ranking_and_etas(fixture_json):
    respx.post(DIRECTIONS).mock(
        return_value=httpx.Response(200, json=fixture_json("ors_directions_3routes.json"))
    )
    # Strong wind (SEVERE for wind 45-55) only where the east alternative bulges.
    weather = mock_weather(lambda lat, lng: 50.0 if lng > -99.85 else 15.0)

    out = analysis.analyze_trip(ORIGIN, DEST, DEPARTURE, 10000, 25)

    assert weather.call_count == 1  # one batched weather call for all routes
    routes = out["routes"]
    assert [r["rank"] for r in routes] == [1, 2, 3]
    assert routes[0]["recommended"] is True and not any(r["recommended"] for r in routes[1:])
    east = routes[-1]
    assert east["stats"]["severe_miles"] > 0
    assert routes[0]["stats"]["severe_miles"] == 0
    assert out["recommendation"]["route_id"] == routes[0]["id"]
    assert out["recommendation"]["all_unsafe"] is False
    assert "Severe miles" in out["recommendation"]["explanation"] or "faster" in out["recommendation"]["explanation"]

    # ETAs: first checkpoint = departure, monotonic, last = departure + duration
    for r in routes:
        etas = [datetime.fromisoformat(c["eta"]) for c in r["checkpoints"]]
        assert etas[0] == DEPARTURE
        assert etas == sorted(etas)
        assert (etas[-1] - DEPARTURE).total_seconds() == pytest.approx(r["duration_s"], abs=1)
        assert r["checkpoints"][0]["mile"] == 0
        assert r["geometry"]["type"] == "LineString"
        assert sum(r["stats"]["miles_by_level"].values()) == pytest.approx(
            r["checkpoints"][-1]["covers_end"], abs=0.1
        )
    assert out["warnings"] == []


@respx.mock
def test_heavy_load_flips_high_to_severe(fixture_json):
    respx.post(DIRECTIONS).mock(
        return_value=httpx.Response(200, json=fixture_json("ors_directions_3routes.json"))
    )
    mock_weather(lambda lat, lng: 40.0)  # wind 40 mph = HIGH

    light = analysis.analyze_trip(ORIGIN, DEST, DEPARTURE, 10000, 25)
    weather_client.clear_cache()
    heavy = analysis.analyze_trip(ORIGIN, DEST, DEPARTURE, 45000, 25)

    cp_light = light["routes"][0]["checkpoints"][0]["risk"]
    cp_heavy = heavy["routes"][0]["checkpoints"][0]["risk"]
    assert cp_light["level_name"] == "High"
    assert cp_heavy["level_name"] == "Severe"
    assert any("45,000 lb" in r for r in cp_heavy["reasons"])


@respx.mock
def test_all_unsafe_and_beyond_forecast_warning(fixture_json):
    respx.post(DIRECTIONS).mock(
        return_value=httpx.Response(200, json=fixture_json("ors_directions_3routes.json"))
    )
    mock_weather(lambda lat, lng: 70.0)  # NO_TRAVEL everywhere
    late = datetime(2026, 11, 10, 8, 0, tzinfo=timezone.utc)  # past the 3-day forecast
    out = analysis.analyze_trip(ORIGIN, DEST, late, 1000, 50)

    assert out["recommendation"]["all_unsafe"] is True
    assert "no route is advisable" in out["recommendation"]["explanation"].lower()
    assert not any(r["recommended"] for r in out["routes"])
    assert all(c["beyond_forecast"] for c in out["routes"][0]["checkpoints"])
    assert any("beyond the weather forecast" in w for w in out["warnings"])


@respx.mock
def test_routing_warnings_passed_through(fixture_json):
    one = fixture_json("ors_directions_1route.json")
    respx.post(DIRECTIONS).mock(return_value=httpx.Response(200, json=one))
    mock_weather(lambda lat, lng: 10.0)
    out = analysis.analyze_trip(ORIGIN, DEST, DEPARTURE, 1000, 25)
    assert len(out["routes"]) == 1
    assert any("distinct route" in w for w in out["warnings"])
    assert out["recommendation"]["route_id"] == "route-1"
