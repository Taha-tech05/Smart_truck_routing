"""Open-Meteo hourly forecast client (no API key).

Wind metric: we use **sustained** wind (``wind_speed_10m``), NOT gusts
(``wind_gusts_10m``). The risk thresholds are defined on sustained wind speed;
gusts would systematically over-classify risk. Precipitation uses ``rain``
(not total ``precipitation``) so snow is not double counted with ``snowfall``.

Units are requested directly from the API (mph, inches), so the values here
are already mph and inches/hour: the risk code never converts units.

Batching: many coordinates go into one request (comma-separated ``latitude`` /
``longitude`` lists), chunked at 50 points per request, chunks fetched
concurrently. Results are cached in memory per (round(lat, 1), round(lng, 1))
for 30 minutes, so overlapping routes cost nothing extra.
"""
from __future__ import annotations

import math
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import httpx

from ..constants import HTTP_TIMEOUT_S, OPEN_METEO_BASE_URL

CHUNK_SIZE = 50
CACHE_TTL_S = 30 * 60
MAX_RETRIES = 2
BACKOFF_S = (0.5, 1.0)
MAX_WORKERS = 4
HOURLY_VARS = "wind_speed_10m,rain,snowfall"

Point = tuple[float, float]  # (lat, lng)
CacheKey = tuple[float, float]


class WeatherError(Exception):
    """Weather data could not be retrieved."""


@dataclass(frozen=True)
class HourlyRecord:
    time_utc: datetime
    wind_mph: float
    rain_in_hr: float
    snow_in_hr: float


@dataclass(frozen=True)
class WeatherAtEta:
    time_utc: datetime
    wind_mph: float
    rain_in_hr: float
    snow_in_hr: float
    beyond_forecast: bool


# ---------------------------------------------------------------- cache

_cache: dict[CacheKey, tuple[float, list[HourlyRecord]]] = {}
_cache_lock = threading.Lock()


def _now() -> float:
    return time.monotonic()


def _sleep(seconds: float) -> None:
    time.sleep(seconds)


def clear_cache() -> None:
    with _cache_lock:
        _cache.clear()


def cache_key(point: Point) -> CacheKey:
    return (round(point[0], 1), round(point[1], 1))


def _cache_get(key: CacheKey) -> list[HourlyRecord] | None:
    with _cache_lock:
        item = _cache.get(key)
        if item is None:
            return None
        stored_at, records = item
        if _now() - stored_at > CACHE_TTL_S:
            del _cache[key]
            return None
        return records


def _cache_put(key: CacheKey, records: list[HourlyRecord]) -> None:
    with _cache_lock:
        _cache[key] = (_now(), records)


# ---------------------------------------------------------------- HTTP

_client: httpx.Client | None = None


def _get_client() -> httpx.Client:
    global _client
    if _client is None:
        _client = httpx.Client(timeout=HTTP_TIMEOUT_S)
    return _client


def _fetch_chunk(keys: list[CacheKey], forecast_days: int) -> list[list[HourlyRecord]]:
    """Fetch one batch of locations (with retries); returns records per key, in order."""
    params = {
        "latitude": ",".join(str(k[0]) for k in keys),
        "longitude": ",".join(str(k[1]) for k in keys),
        "hourly": HOURLY_VARS,
        "wind_speed_unit": "mph",
        "precipitation_unit": "inch",
        "timezone": "UTC",
        "forecast_days": forecast_days,
    }
    last_error = "unknown error"
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = _get_client().get(OPEN_METEO_BASE_URL, params=params, timeout=HTTP_TIMEOUT_S)
        except httpx.TimeoutException:
            last_error = "request timed out"
        except httpx.HTTPError as exc:
            last_error = f"network error: {exc}"
        else:
            if resp.status_code >= 500:
                last_error = f"server error ({resp.status_code})"
            elif resp.status_code == 429:
                raise WeatherError("Open-Meteo rate limit exceeded")
            elif resp.status_code >= 400:
                raise WeatherError(f"Open-Meteo rejected the request ({resp.status_code})")
            else:
                return _parse(resp, len(keys))
        if attempt < MAX_RETRIES:
            _sleep(BACKOFF_S[min(attempt, len(BACKOFF_S) - 1)])
    raise WeatherError(f"Open-Meteo unavailable: {last_error}")


def _parse(resp: httpx.Response, expected: int) -> list[list[HourlyRecord]]:
    try:
        data = resp.json()
    except ValueError as exc:
        raise WeatherError("Open-Meteo returned invalid JSON") from exc
    locations = data if isinstance(data, list) else [data]
    if len(locations) != expected:
        raise WeatherError(
            f"Open-Meteo returned {len(locations)} locations, expected {expected}"
        )
    out: list[list[HourlyRecord]] = []
    for loc in locations:
        try:
            h = loc["hourly"]
            times, wind, rain, snow = h["time"], h["wind_speed_10m"], h["rain"], h["snowfall"]
        except (KeyError, TypeError) as exc:
            raise WeatherError("Open-Meteo response is missing hourly data") from exc
        records = []
        for t, w, r, s in zip(times, wind, rain, snow):
            if w is None:
                continue
            records.append(
                HourlyRecord(
                    time_utc=datetime.fromisoformat(t).replace(tzinfo=timezone.utc),
                    wind_mph=float(w),
                    rain_in_hr=float(r or 0.0),
                    snow_in_hr=float(s or 0.0),
                )
            )
        if not records:
            raise WeatherError("Open-Meteo returned no hourly records")
        out.append(records)
    return out


# ---------------------------------------------------------------- public API

def get_hourly_weather(
    points: list[Point], hours_ahead: int = 48
) -> dict[Point, list[HourlyRecord]]:
    """Hourly records for each ``(lat, lng)`` point, keyed by the point as given.

    ``hours_ahead`` sets the number of forecast days requested
    (``ceil(hours_ahead / 24) + 1``, i.e. 3 days for 48 hours).
    """
    forecast_days = min(16, max(1, math.ceil(hours_ahead / 24) + 1))
    missing: list[CacheKey] = []
    seen: set[CacheKey] = set()
    for p in points:
        k = cache_key(p)
        if k not in seen and _cache_get(k) is None:
            missing.append(k)
        seen.add(k)

    chunks = [missing[i : i + CHUNK_SIZE] for i in range(0, len(missing), CHUNK_SIZE)]
    if chunks:
        with ThreadPoolExecutor(max_workers=min(MAX_WORKERS, len(chunks))) as pool:
            results = list(pool.map(lambda c: _fetch_chunk(c, forecast_days), chunks))
        for chunk, chunk_records in zip(chunks, results):
            for key, records in zip(chunk, chunk_records):
                _cache_put(key, records)

    out: dict[Point, list[HourlyRecord]] = {}
    for p in points:
        records = _cache_get(cache_key(p))
        if records is None:  # expired mid-call (extremely unlikely)
            raise WeatherError("Weather cache expired during request; please retry")
        out[p] = records
    return out


def nearest_record(
    records: list[HourlyRecord], eta: datetime
) -> tuple[HourlyRecord, bool]:
    """Record whose hour is nearest ``eta``; flag True if eta is past the forecast end."""
    best = min(records, key=lambda r: abs(r.time_utc - eta))
    last = records[-1]
    beyond = eta > last.time_utc + timedelta(minutes=30)
    return (last if beyond else best), beyond


def weather_at(
    points_with_etas: list[tuple[float, float, datetime]], hours_ahead: int = 48
) -> list[WeatherAtEta]:
    """For each ``(lat, lng, eta)`` return the forecast for the hour nearest eta.

    If eta is beyond the forecast window the last available hour is used and
    ``beyond_forecast`` is True.
    """
    for _, _, eta in points_with_etas:
        if eta.tzinfo is None:
            raise ValueError("eta must be timezone-aware")
    hourly = get_hourly_weather([(lat, lng) for lat, lng, _ in points_with_etas], hours_ahead)
    out: list[WeatherAtEta] = []
    for lat, lng, eta in points_with_etas:
        rec, beyond = nearest_record(hourly[(lat, lng)], eta)
        out.append(WeatherAtEta(rec.time_utc, rec.wind_mph, rec.rain_in_hr, rec.snow_in_hr, beyond))
    return out
