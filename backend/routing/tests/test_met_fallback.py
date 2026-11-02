"""MET Norway fallback: parsing, unit conversion and when it kicks in. No network."""
from datetime import datetime, timezone

import httpx
import pytest
import respx

from routing.constants import OPEN_METEO_BASE_URL
from routing.services import met_norway as met
from routing.services import weather_client as wc

DAILY = {"error": True, "reason": "Daily API request limit exceeded. Please try again tomorrow."}


def met_payload(temp=5.0, wind_ms=10.0, mm_1h=2.54):
    return {"properties": {"timeseries": [
        {"time": "2026-11-02T10:00:00Z",
         "data": {"instant": {"details": {"wind_speed": wind_ms, "air_temperature": temp}},
                  "next_1_hours": {"details": {"precipitation_amount": mm_1h}}}},
        {"time": "2026-11-02T11:00:00Z",
         "data": {"instant": {"details": {"wind_speed": wind_ms, "air_temperature": temp}},
                  "next_1_hours": {"details": {"precipitation_amount": 0.0}}}},
        {"time": "2026-11-02T17:00:00Z",   # 6-hourly step: expanded to hourly records
         "data": {"instant": {"details": {"wind_speed": 5.0, "air_temperature": temp}},
                  "next_6_hours": {"details": {"precipitation_amount": 6.0}}}},
    ]}}


@pytest.fixture(autouse=True)
def _clean(monkeypatch, settings):
    settings.WEATHER_FALLBACK_ENABLED = True
    wc.clear_cache()
    monkeypatch.setattr(wc, "_sleep", lambda s: None)
    monkeypatch.setattr(met.time, "sleep", lambda s: None)
    yield
    wc.clear_cache()


def test_parse_converts_units_rain():
    recs = met.parse(met_payload(temp=5.0), wc.HourlyRecord)
    first = recs[0]
    assert first.source == "met-norway"
    assert first.wind_mph == pytest.approx(10 * 2.23694)
    assert first.rain_in_hr == pytest.approx(2.54 / 25.4) and first.snow_in_hr == 0


def test_parse_cold_precip_is_snow_at_10_to_1():
    first = met.parse(met_payload(temp=-3.0), wc.HourlyRecord)[0]
    assert first.rain_in_hr == 0
    assert first.snow_in_hr == pytest.approx(2.54 * 10 / 25.4)


def test_parse_expands_six_hourly_steps_to_hourly():
    recs = met.parse(met_payload(), wc.HourlyRecord)
    times = [r.time_utc for r in recs]
    assert times[:2] == [datetime(2026, 11, 2, 10, tzinfo=timezone.utc), datetime(2026, 11, 2, 11, tzinfo=timezone.utc)]
    # 11:00 step lasts until the 17:00 entry: hourly records in between, then 6 mm over 6 h = 1 mm/h
    assert len([t for t in times if 11 <= t.hour < 17]) == 6
    assert [r for r in recs if r.time_utc.hour == 17][0].rain_in_hr == pytest.approx(1.0 / 25.4)


@respx.mock
def test_daily_limit_falls_back_to_met_and_skips_open_meteo_afterwards():
    om = respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(429, json=DAILY))
    mt = respx.get(met.MET_URL).mock(return_value=httpx.Response(200, json=met_payload()))
    out = wc.get_hourly_weather([(35.0, -100.0), (36.0, -101.0)])
    assert {r.source for recs in out.values() for r in recs} == {"met-norway"}
    assert mt.call_count == 2 and om.call_count == 1
    assert mt.calls[0].request.headers["User-Agent"].startswith("truck-weather-router")
    assert mt.calls[0].request.url.params["lat"] == "35.0000"

    wc._cache.clear()  # keep the open-meteo block, drop cached weather
    wc.get_hourly_weather([(37.0, -102.0)])
    assert om.call_count == 1  # blocked: went straight to MET


@respx.mock
def test_both_providers_failing_raises_weather_error():
    respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(429, json=DAILY))
    respx.get(met.MET_URL).mock(return_value=httpx.Response(503))
    with pytest.raises(wc.WeatherError, match="MET Norway also failed"):
        wc.get_hourly_weather([(35.0, -100.0)])


@respx.mock
def test_no_fallback_when_disabled(settings):
    settings.WEATHER_FALLBACK_ENABLED = False
    respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(429, json=DAILY))
    mt = respx.get(met.MET_URL).mock(return_value=httpx.Response(200, json=met_payload()))
    with pytest.raises(wc.WeatherError, match="daily request limit"):
        wc.get_hourly_weather([(35.0, -100.0)])
    assert mt.call_count == 0


@respx.mock
def test_bad_request_is_not_a_fallback_case():
    respx.get(OPEN_METEO_BASE_URL).mock(return_value=httpx.Response(400, json={"reason": "bad"}))
    mt = respx.get(met.MET_URL).mock(return_value=httpx.Response(200, json=met_payload()))
    with pytest.raises(wc.WeatherError, match="rejected"):
        wc.get_hourly_weather([(35.0, -100.0)])
    assert mt.call_count == 0
