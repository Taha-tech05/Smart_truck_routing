"""MET Norway Locationforecast: free fallback when Open-Meteo is unavailable.

Used only by weather_client after Open-Meteo fails (daily limit, throttling, outage).
Returns the same ``HourlyRecord`` objects (mph, inches/hour) tagged ``source="met-norway"``.

Conversions:
  wind   m/s -> mph (x 2.23694); the 10 m mean wind, like Open-Meteo's wind_speed_10m
  precip mm/h (liquid equivalent) -> rain in/hr when air temperature > 0 C, otherwise
         snow in/hr at a 10:1 snow-to-liquid ratio (MET has no separate snowfall field)

MET's terms require an identifying User-Agent and at most ~20 requests/second.
"""
from __future__ import annotations

import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

import httpx

log = logging.getLogger(__name__)

MET_URL = "https://api.met.no/weatherapi/locationforecast/2.0/compact"
MS_TO_MPH = 2.23694
MM_PER_INCH = 25.4
SNOW_RATIO = 10.0
MAX_WORKERS = 5          # well under MET's 20 req/s guidance
MAX_HOURS = 96           # records are expanded to hourly steps up to this horizon
TIMEOUT_S = 10.0
DEFAULT_USER_AGENT = "truck-weather-router/1.0 github.com/Taha-tech05/Smart_truck_routing"


class MetError(Exception):
    """MET Norway could not provide the forecast."""


def _user_agent() -> str:
    from django.conf import settings

    return getattr(settings, "MET_USER_AGENT", "") or DEFAULT_USER_AGENT


def _precip_mm_per_hour(data: dict) -> float:
    for key, hours in (("next_1_hours", 1), ("next_6_hours", 6), ("next_12_hours", 12)):
        block = data.get(key)
        if block:
            amount = block.get("details", {}).get("precipitation_amount")
            if amount is not None:
                return float(amount) / hours
    return 0.0


def parse(payload: dict, record_cls):
    """Expand MET's timeseries (hourly, then 6-hourly) into hourly ``record_cls`` objects."""
    try:
        series = payload["properties"]["timeseries"]
    except (KeyError, TypeError) as exc:
        raise MetError("MET Norway response is missing the timeseries") from exc
    steps = []
    for entry in series:
        try:
            when = datetime.fromisoformat(entry["time"].replace("Z", "+00:00")).astimezone(timezone.utc)
            data = entry["data"]
            details = data["instant"]["details"]
            wind = float(details["wind_speed"]) * MS_TO_MPH
            temp = details.get("air_temperature")
        except (KeyError, TypeError, ValueError):
            continue
        mm_h = _precip_mm_per_hour(data)
        is_snow = temp is not None and float(temp) <= 0.0
        steps.append((when, wind, 0.0 if is_snow else mm_h / MM_PER_INCH, mm_h * SNOW_RATIO / MM_PER_INCH if is_snow else 0.0))
    if not steps:
        raise MetError("MET Norway returned no usable forecast steps")

    records = []
    horizon = steps[0][0] + timedelta(hours=MAX_HOURS)
    for i, (when, wind, rain, snow) in enumerate(steps):
        end = steps[i + 1][0] if i + 1 < len(steps) else when + timedelta(hours=1)
        t = when
        while t < end and t <= horizon:
            records.append(record_cls(time_utc=t, wind_mph=wind, rain_in_hr=rain, snow_in_hr=snow, source="met-norway"))
            t += timedelta(hours=1)
    return records


def _fetch_one(client: httpx.Client, lat: float, lng: float, record_cls):
    params = {"lat": f"{lat:.4f}", "lon": f"{lng:.4f}"}  # MET rejects more than 4 decimals
    headers = {"User-Agent": _user_agent()}
    last = "unknown error"
    for attempt in range(2):
        try:
            resp = client.get(MET_URL, params=params, headers=headers, timeout=TIMEOUT_S)
        except httpx.HTTPError as exc:
            last = f"network error ({type(exc).__name__})"
        else:
            if resp.status_code == 200:
                try:
                    return parse(resp.json(), record_cls)
                except ValueError as exc:
                    raise MetError("MET Norway returned invalid JSON") from exc
            last = f"HTTP {resp.status_code}"
            if resp.status_code < 500 and resp.status_code != 429:
                break
        if attempt == 0:
            time.sleep(0.5)
    raise MetError(f"MET Norway failed: {last}")


def fetch_locations(points: list[tuple[float, float]], record_cls) -> list[list]:
    """Hourly records for each ``(lat, lng)``, in order. Raises MetError if any location fails."""
    t0 = time.perf_counter()
    with httpx.Client(timeout=TIMEOUT_S) as client:
        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, max(1, len(points)))) as pool:
            out = list(pool.map(lambda p: _fetch_one(client, p[0], p[1], record_cls), points))
    log.info("MET Norway fallback ok locations=%d elapsed_ms=%d", len(points), (time.perf_counter() - t0) * 1000)
    return out
