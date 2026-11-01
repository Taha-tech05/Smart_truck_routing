"""Manual smoke test against the REAL ORS and Open-Meteo APIs.

NOT part of pytest and never run in CI. Needs ORS_API_KEY in backend/.env.

    cd backend
    python scripts/smoke_test.py

Calls analyze_trip directly for three trips, prints a summary of each route,
writes the full JSON to scripts/out/<trip>.json and flags anything suspicious.
"""
from __future__ import annotations

import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import httpx

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django  # noqa: E402

django.setup()  # also loads backend/.env via config.settings

from django.conf import settings  # noqa: E402

from routing.services import analysis, routing_client, weather_client  # noqa: E402

OUT_DIR = Path(__file__).resolve().parent / "out"
LOAD_LB = 40_000
INTERVAL = 25
SLOW_S = 15.0

PLACES = {
    "Dallas": {"lat": 32.7767, "lng": -96.7970, "label": "Dallas, TX"},
    "Denver": {"lat": 39.7392, "lng": -104.9903, "label": "Denver, CO"},
    "Fort Worth": {"lat": 32.7555, "lng": -97.3308, "label": "Fort Worth, TX"},
    "Austin": {"lat": 30.2672, "lng": -97.7431, "label": "Austin, TX"},
    "Houston": {"lat": 29.7604, "lng": -95.3698, "label": "Houston, TX"},
    "Salt Lake City": {"lat": 40.7608, "lng": -111.8910, "label": "Salt Lake City, UT"},
    "Minneapolis": {"lat": 44.9778, "lng": -93.2650, "label": "Minneapolis, MN"},
    "Chicago": {"lat": 41.8781, "lng": -87.6298, "label": "Chicago, IL"},
}
TRIPS = [
    ("dallas_denver", "Dallas", "Denver"),
    ("dallas_fortworth", "Dallas", "Fort Worth"),
    ("austin_houston", "Austin", "Houston"),
    ("denver_saltlake", "Denver", "Salt Lake City"),
    ("minneapolis_chicago", "Minneapolis", "Chicago"),
]

timings: dict[str, float] = {}


def timed(module, name: str):
    """Wrap module.name to accumulate its wall-clock time in ``timings``."""
    original = getattr(module, name)

    def wrapper(*args, **kwargs):
        start = time.perf_counter()
        try:
            return original(*args, **kwargs)
        finally:
            timings[name] = timings.get(name, 0.0) + time.perf_counter() - start

    setattr(module, name, wrapper)


def fmt_duration(seconds: float) -> str:
    m = round(seconds / 60)
    return f"{m // 60}h{m % 60:02d}m"


def check(result: dict, elapsed: float) -> list[str]:
    """Return a list of suspicious findings for one trip."""
    problems: list[str] = []
    routes = result["routes"]
    fastest = min(routes, key=lambda r: r["duration_s"])
    for r in routes:
        if r["distance_miles"] > 1.5 * fastest["distance_miles"]:
            problems.append(f"{r['id']} is {r['distance_miles'] / fastest['distance_miles']:.2f}x longer than fastest")
    for i, a in enumerate(routes):
        for b in routes[i + 1:]:
            ca = [tuple(c) for c in a["geometry"]["coordinates"]]
            cb = [tuple(c) for c in b["geometry"]["coordinates"]]
            if routing_client.is_duplicate(ca, cb):
                problems.append(f"{a['id']} and {b['id']} are near-duplicates")
    for r in routes:
        etas = [datetime.fromisoformat(c["eta"]) for c in r["checkpoints"]]
        if any(y <= x for x, y in zip(etas, etas[1:])):
            problems.append(f"{r['id']} has ETAs that do not increase")
        w = [c["weather"] for c in r["checkpoints"]]
        if not w or any(v is None for c in w for v in c.values()):
            problems.append(f"{r['id']} has missing weather values")
        elif all(c["wind_mph"] == 0 and c["rain_in_hr"] == 0 and c["snow_in_hr"] == 0 for c in w):
            problems.append(f"{r['id']} weather is all zero")
    if elapsed > SLOW_S:
        problems.append(f"analysis took {elapsed:.1f}s (> {SLOW_S:.0f}s)")
    return problems


def verify_weather(result: dict) -> bool:
    """Compare our parsed values for the windiest checkpoint with raw Open-Meteo.

    The raw call is independent of weather_client: its own httpx request in the
    API's NATIVE units (km/h, mm, cm), converted here, with the hour located by
    matching the time string. It uses the same rounded (0.1 degree) coordinates
    the client requests, so the comparison isolates parsing, units, hour index
    and rain-vs-precipitation. Values at the exact checkpoint lat/lng are shown
    for information (they can differ slightly because of that rounding).
    """
    best = None
    for r in result["routes"]:
        for c in r["checkpoints"]:
            if not c["beyond_forecast"] and (best is None or c["weather"]["wind_mph"] > best[1]["weather"]["wind_mph"]):
                best = (r["id"], c)
    if best is None:
        print("Weather verification: no in-forecast checkpoint to verify")
        return True
    route_id, c = best
    eta = datetime.fromisoformat(c["eta"]).astimezone(timezone.utc)
    hour = (eta + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)
    hour_key = hour.strftime("%Y-%m-%dT%H:%M")

    def raw(lat: float, lng: float) -> dict:
        resp = httpx.get(
            "https://api.open-meteo.com/v1/forecast",
            params={"latitude": lat, "longitude": lng, "timezone": "UTC", "forecast_days": 3,
                    "hourly": "wind_speed_10m,rain,snowfall,precipitation"},
            timeout=10,
        )
        resp.raise_for_status()
        h = resp.json()["hourly"]
        i = h["time"].index(hour_key)
        return {
            "wind_mph": h["wind_speed_10m"][i] / 1.609344,   # km/h -> mph
            "rain_in_hr": h["rain"][i] / 25.4,               # mm -> in
            "snow_in_hr": h["snowfall"][i] / 2.54,           # cm -> in
            "precip_in_hr": h["precipitation"][i] / 25.4,
        }

    mine = c["weather"]
    rounded = raw(round(c["lat"], 1), round(c["lng"], 1))
    exact = raw(c["lat"], c["lng"])
    # Tolerances cover Open-Meteo's own output rounding (0.1 km/h ~ 0.06 mph, 0.01 mm,
    # 0.01 cm) that is amplified when the km/h/mm/cm values are converted here.
    tolerance = {"wind_mph": 0.1, "rain_in_hr": 0.002, "snow_in_hr": 0.005}
    match = all(abs(mine[k] - rounded[k]) <= tol for k, tol in tolerance.items())
    print(f"Weather verification: {route_id} mile {c['mile']} at ({c['lat']:.3f}, {c['lng']:.3f}), "
          f"ETA {eta:%H:%M}Z -> hour used {hour_key}Z")
    print(f"    ours            wind {mine['wind_mph']:.3f}  rain {mine['rain_in_hr']:.4f}  snow {mine['snow_in_hr']:.4f}")
    print(f"    raw (rounded)   wind {rounded['wind_mph']:.3f}  rain {rounded['rain_in_hr']:.4f}  "
          f"snow {rounded['snow_in_hr']:.4f}  (precipitation {rounded['precip_in_hr']:.4f})")
    print(f"    raw (exact pt)  wind {exact['wind_mph']:.3f}  rain {exact['rain_in_hr']:.4f}  "
          f"snow {exact['snow_in_hr']:.4f}  [info only]")
    print(f"    {'MATCH' if match else 'MISMATCH'}")
    return match


def run_trip(slug: str, origin_name: str, dest_name: str, departure: datetime) -> bool:
    print("=" * 78)
    print(f"{origin_name} -> {dest_name}   (load {LOAD_LB:,} lb, every {INTERVAL} mi, "
          f"departing {departure:%Y-%m-%d %H:%M} UTC)")
    print("=" * 78)
    timings.clear()
    weather_client.clear_cache()
    start = time.perf_counter()
    try:
        result = analysis.analyze_trip(
            PLACES[origin_name], PLACES[dest_name], departure, LOAD_LB, INTERVAL
        )
    except Exception as exc:  # smoke test: show any failure and carry on
        print(f"FAILED: {type(exc).__name__}: {exc}\n")
        return False
    elapsed = time.perf_counter() - start

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / f"{slug}.json").write_text(json.dumps(result, indent=2), encoding="utf-8")

    for r in result["routes"]:
        s = r["stats"]
        print(f"[{r['rank']}] {r['id']}  provider=OpenRouteService/driving-hgv  "
              f"summary={r['summary']!r}  recommended={r['recommended']}")
        print(f"    distance={r['distance_miles']:.1f} mi  duration={fmt_duration(r['duration_s'])}  "
              f"checkpoints={len(r['checkpoints'])}  vertices={len(r['geometry']['coordinates'])}")
        print(f"    severe={s['severe_miles']:.1f} mi  high={s['high_miles']:.1f} mi  "
              f"no_travel={s['no_travel_miles']:.1f} mi  avg_risk={s['avg_risk']:.2f}  "
              f"worst={s['worst_level_name']}")
        cps = r["checkpoints"]
        print(f"    max wind={max(c['weather']['wind_mph'] for c in cps):.1f} mph  "
              f"max rain={max(c['weather']['rain_in_hr'] for c in cps):.3f} in/hr  "
              f"max snow={max(c['weather']['snow_in_hr'] for c in cps):.3f} in/hr")
        for c in r["checkpoints"][:3]:
            w = c["weather"]
            print(f"      mile {c['mile']:7.1f}  eta {c['eta']}  wind {w['wind_mph']:5.1f} mph  "
                  f"rain {w['rain_in_hr']:.2f}  snow {w['snow_in_hr']:.2f}  -> {c['risk']['level_name']}")
    rec = result["recommendation"]
    print(f"\nRecommendation: {rec['route_id']} (all_unsafe={rec['all_unsafe']}): {rec['explanation']}")
    print(f"Warnings: {result['warnings'] or 'none'}")
    step = "  ".join(f"{k}={v:.2f}s" for k, v in timings.items())
    print(f"Elapsed: {elapsed:.2f}s   [{step}]")
    problems = check(result, elapsed)
    try:
        if not verify_weather(result):
            problems.append("weather MISMATCH vs raw Open-Meteo")
    except Exception as exc:  # verification itself must not hide the rest of the report
        problems.append(f"weather verification failed: {type(exc).__name__}: {exc}")
    print("Checks: " + ("OK" if not problems else "PROBLEMS -> " + "; ".join(problems)))
    print(f"JSON: {OUT_DIR / (slug + '.json')}\n")
    return not problems


def main() -> int:
    if not settings.ORS_API_KEY:
        print("ORS_API_KEY is empty. Add it to backend/.env and re-run.")
        return 2
    timed(routing_client, "get_routes")
    timed(weather_client, "weather_at")
    timed(routing_client, "ors_request")
    departure = (datetime.now(timezone.utc) + timedelta(hours=1)).replace(minute=0, second=0, microsecond=0)
    ok = [run_trip(slug, o, d, departure) for slug, o, d in TRIPS]
    return 0 if all(ok) else 1


if __name__ == "__main__":
    sys.exit(main())
