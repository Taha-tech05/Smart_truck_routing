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
}
TRIPS = [
    ("dallas_denver", "Dallas", "Denver"),
    ("dallas_fortworth", "Dallas", "Fort Worth"),
    ("austin_houston", "Austin", "Houston"),
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
