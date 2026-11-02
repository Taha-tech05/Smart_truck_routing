"""Tests for services.weather_client (HTTP mocked with respx; no network)."""
from datetime import datetime, timezone

import httpx
import pytest
import respx

from routing.constants import OPEN_METEO_BASE_URL
from routing.services import weather_client as wc

UTC = timezone.utc


@pytest.fixture(autouse=True)
def _clean(monkeypatch, settings):
    settings.WEATHER_FALLBACK_ENABLED = False  # fallback has its own tests (test_met_fallback.py)
    wc.clear_cache()
    monkeypatch.setattr(wc, "_sleep", lambda s: None)
    yield
    wc.clear_cache()


def hours(start="2026-11-02T00:00", n=72):
    base = datetime.fromisoformat(start)
    from datetime import timedelta
    return [(base + timedelta(hours=i)).strftime("%Y-%m-%dT%H:%M") for i in range(n)]


def location(lat, n=72):
    """Deterministic fake hourly block: wind = lat + hour index/100."""
    return {
        "latitude": lat,
        "hourly": {
            "time": hours(n=n),
            "wind_speed_10m": [lat + i / 100 for i in range(n)],
            "rain": [0.01 * (i % 3) for i in range(n)],
            "snowfall": [0.0] * n,
        },
    }


def handler(request):
    lats = [float(x) for x in request.url.params["latitude"].split(",")]
    body = [location(lat) for lat in lats]
    return httpx.Response(200, json=body if len(body) > 1 else body[0])


@respx.mock
def test_parses_multi_location_response_and_params():
    route = respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    pts = [(30.0, -100.0), (31.0, -99.0)]
    out = wc.get_hourly_weather(pts)
    p = route.calls[0].request.url.params
    assert p["hourly"] == "wind_speed_10m,rain,snowfall"
    assert p["wind_speed_unit"] == "mph" and p["precipitation_unit"] == "inch"
    assert p["timezone"] == "UTC" and p["forecast_days"] == "3"
    assert p["latitude"] == "30.0,31.0" and p["longitude"] == "-100.0,-99.0"
    first = out[pts[0]][0]
    assert first.time_utc == datetime(2026, 11, 2, 0, 0, tzinfo=UTC)
    assert first.wind_mph == 30.0
    assert out[pts[1]][5].wind_mph == pytest.approx(31.05)
    assert len(out[pts[0]]) == 72


@respx.mock
def test_single_location_dict_response():
    respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    out = wc.get_hourly_weather([(40.0, -90.0)])
    assert out[(40.0, -90.0)][0].wind_mph == 40.0


@respx.mock
def test_120_points_make_3_requests():
    route = respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    pts = [(30.0 + i * 0.1, -100.0) for i in range(120)]
    out = wc.get_hourly_weather(pts)
    assert route.call_count == 3
    sizes = sorted(len(c.request.url.params["latitude"].split(",")) for c in route.calls)
    assert sizes == [20, 50, 50]
    assert len(out) == 120
    # mapping stays correct across chunks
    for p in (pts[0], pts[60], pts[119]):
        assert out[p][0].wind_mph == pytest.approx(round(p[0], 1))


@respx.mock
def test_cache_hit_avoids_second_request():
    route = respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    wc.get_hourly_weather([(35.0, -100.0)])
    wc.get_hourly_weather([(35.04, -100.04)])  # same 0.1-degree cell
    assert route.call_count == 1
    wc.get_hourly_weather([(35.0, -100.0), (36.0, -100.0)])  # only the new one fetched
    assert route.call_count == 2
    assert route.calls[1].request.url.params["latitude"] == "36.0"


@respx.mock
def test_cache_expires_after_ttl(monkeypatch):
    route = respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    t = [1000.0]
    monkeypatch.setattr(wc, "_now", lambda: t[0])
    wc.get_hourly_weather([(35.0, -100.0)])
    t[0] += wc.CACHE_TTL_S - 1
    wc.get_hourly_weather([(35.0, -100.0)])
    assert route.call_count == 1
    t[0] += 2
    wc.get_hourly_weather([(35.0, -100.0)])
    assert route.call_count == 2


@respx.mock
def test_nearest_hour_selection():
    respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    eta = datetime(2026, 11, 2, 13, 40, tzinfo=UTC)
    [w] = wc.weather_at([(30.0, -100.0, eta)])
    assert w.time_utc == datetime(2026, 11, 2, 14, 0, tzinfo=UTC)
    assert w.wind_mph == pytest.approx(30.14)
    assert w.beyond_forecast is False
    # works with a non-UTC aware eta too (13:40 UTC == 08:40 at UTC-5)
    from datetime import timedelta
    eta2 = datetime(2026, 11, 2, 8, 40, tzinfo=timezone(timedelta(hours=-5)))
    [w2] = wc.weather_at([(30.0, -100.0, eta2)])
    assert w2.time_utc == w.time_utc


@respx.mock
def test_beyond_forecast_flag_uses_last_hour():
    respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    last = datetime(2026, 11, 4, 23, 0, tzinfo=UTC)
    far = datetime(2026, 11, 7, 12, 0, tzinfo=UTC)
    edge = datetime(2026, 11, 4, 23, 20, tzinfo=UTC)  # within half an hour of last slot
    out = wc.weather_at([(30.0, -100.0, far), (30.0, -100.0, edge)])
    assert out[0].beyond_forecast is True and out[0].time_utc == last
    assert out[1].beyond_forecast is False and out[1].time_utc == last


def test_naive_eta_rejected():
    with pytest.raises(ValueError):
        wc.weather_at([(30.0, -100.0, datetime(2026, 11, 2, 12, 0))])


@respx.mock
def test_retries_on_5xx_then_succeeds():
    calls = {"n": 0}

    def flaky(request):
        calls["n"] += 1
        if calls["n"] < 3:
            return httpx.Response(503)
        return handler(request)

    respx.get(OPEN_METEO_BASE_URL).mock(side_effect=flaky)
    out = wc.get_hourly_weather([(30.0, -100.0)])
    assert calls["n"] == 3  # 1 try + 2 retries
    assert out[(30.0, -100.0)]


@respx.mock
def test_gives_up_after_retries_on_5xx():
    route = respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(500))
    with pytest.raises(wc.WeatherError, match="unavailable"):
        wc.get_hourly_weather([(30.0, -100.0)])
    assert route.call_count == 3


@respx.mock
def test_timeout_retried_then_error():
    route = respx.get(OPEN_METEO_BASE_URL).mock(side_effect=httpx.ReadTimeout("slow"))
    with pytest.raises(wc.WeatherError, match="timed out"):
        wc.get_hourly_weather([(30.0, -100.0)])
    assert route.call_count == 3


@respx.mock
def test_4xx_not_retried():
    route = respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(400, json={"reason": "bad"}))
    with pytest.raises(wc.WeatherError, match="rejected"):
        wc.get_hourly_weather([(30.0, -100.0)])
    assert route.call_count == 1


@respx.mock
def test_rate_limit_error():
    route = respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(429))
    with pytest.raises(wc.WeatherError, match="rate limit"):
        wc.get_hourly_weather([(30.0, -100.0)])
    assert route.call_count == 1 + wc.RATE_LIMIT_RETRIES  # retried with backoff, then gave up


@respx.mock
def test_rate_limit_then_success_honours_retry_after(monkeypatch):
    waits = []
    monkeypatch.setattr(wc, "_sleep", waits.append)
    calls = {"n": 0}

    def throttled(request):
        calls["n"] += 1
        if calls["n"] <= 2:
            return httpx.Response(429, headers={"Retry-After": "3"} if calls["n"] == 1 else {})
        return handler(request)

    respx.get(OPEN_METEO_BASE_URL).mock(side_effect=throttled)
    assert wc.get_hourly_weather([(30.0, -100.0)])[(30.0, -100.0)]
    assert waits == [3.0, wc.RATE_LIMIT_BACKOFF_S[1]]


@respx.mock
def test_malformed_response_raises():
    respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(200, json={"oops": 1}))
    with pytest.raises(wc.WeatherError):
        wc.get_hourly_weather([(30.0, -100.0)])


# ---------------------------------------------------------------- cache precision

def requested_lats(route):
    return [float(x) for c in route.calls for x in c.request.url.params["latitude"].split(",")]


def test_cache_key_includes_precision():
    p = (35.04, -100.04)
    assert wc.cache_key(p) == (1, 35.0, -100.0)
    assert wc.cache_key(p, 2) == (2, 35.04, -100.04)
    assert wc.cache_key(p, 1) != wc.cache_key(p, 2)
    # same rounded numbers at different precision never collide
    assert wc.cache_key((35.0, -100.0), 1) != wc.cache_key((35.0, -100.0), 2)


@respx.mock
def test_points_004_apart_share_entry_at_precision_1_but_not_2():
    route = respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    a, b = (35.01, -100.0), (35.05, -100.0)  # 0.04 degrees apart
    wc.get_hourly_weather([a, b], precision=1)
    assert requested_lats(route) == [35.0]  # one shared cell
    wc.clear_cache()
    first = route.call_count
    wc.get_hourly_weather([a, b], precision=2)
    second = [float(x) for c in route.calls[first:] for x in c.request.url.params["latitude"].split(",")]
    assert second == [35.01, 35.05]  # separate entries


@respx.mock
def test_precision_2_returns_each_points_own_weather():
    respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)  # wind = latitude requested
    a, b = (35.01, -100.0), (35.05, -100.0)
    out = wc.get_hourly_weather([a, b], precision=2)
    assert out[a][0].wind_mph == 35.01 and out[b][0].wind_mph == 35.05
    wc.clear_cache()
    coarse = wc.get_hourly_weather([a, b], precision=1)
    assert coarse[a][0].wind_mph == coarse[b][0].wind_mph == 35.0  # served the shared cell


@respx.mock
def test_precisions_do_not_share_or_collide_in_cache():
    route = respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    p = (35.0, -100.0)
    wc.get_hourly_weather([p], precision=1)
    wc.get_hourly_weather([p], precision=2)
    assert route.call_count == 2          # not served from the other precision's entry
    wc.get_hourly_weather([p], precision=1)
    wc.get_hourly_weather([p], precision=2)
    assert route.call_count == 2          # but each is cached on its own


@respx.mock
def test_weather_at_passes_precision_through():
    route = respx.get(OPEN_METEO_BASE_URL).mock(side_effect=handler)
    eta = datetime(2026, 11, 2, 13, 0, tzinfo=UTC)
    [w] = wc.weather_at([(35.04, -100.0, eta)], precision=2)
    assert requested_lats(route) == [35.04] and w.wind_mph == pytest.approx(35.04 + 0.13)


@respx.mock
def test_api_key_switches_to_customer_host(settings):
    settings.OPEN_METEO_API_KEY = "k-123"
    route = respx.get(wc.OPEN_METEO_CUSTOMER_URL).mock(side_effect=handler)
    assert wc.get_hourly_weather([(30.0, -100.0)])[(30.0, -100.0)]
    assert route.calls[0].request.url.params["apikey"] == "k-123"


@respx.mock
def test_daily_limit_fails_fast_without_retries():
    route = respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(
        429, json={"error": True, "reason": "Daily API request limit exceeded. Please try again tomorrow."}))
    with pytest.raises(wc.WeatherError, match="daily request limit"):
        wc.get_hourly_weather([(30.0, -100.0)])
    assert route.call_count == 1
