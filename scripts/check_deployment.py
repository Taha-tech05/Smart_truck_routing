#!/usr/bin/env python3
"""Smoke-check a deployment.

    python scripts/check_deployment.py https://your-api.onrender.com https://your-app.vercel.app

Checks: health endpoint, CORS preflight from the frontend origin, and a real
POST /api/analyze (Dallas -> Denver). The analyze check uses OpenRouteService
and Open-Meteo, so it spends a little of your ORS quota. Standard library only.
"""
from __future__ import annotations

import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timedelta, timezone

COLD_START_TIMEOUT_S = 90  # a sleeping free Render service can take a minute to wake


def request(method: str, url: str, headers=None, body=None, timeout=COLD_START_TIMEOUT_S):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method, headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.status, dict(resp.headers), resp.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as exc:
        return exc.code, dict(exc.headers), exc.read().decode("utf-8", "replace")


def report(name: str, ok: bool, started: float, detail: str = "") -> bool:
    print(f"{'PASS' if ok else 'FAIL'}  {name:<26} {time.perf_counter() - started:6.2f}s  {detail}")
    return ok


def check_health(api: str) -> bool:
    t = time.perf_counter()
    try:
        status, _, body = request("GET", f"{api}/api/health")
        ok = status == 200 and json.loads(body).get("status") == "ok"
        return report("health", ok, t, f"HTTP {status} {body[:80]}")
    except Exception as exc:  # noqa: BLE001
        return report("health", False, t, repr(exc))


def check_cors(api: str, origin: str) -> bool:
    t = time.perf_counter()
    try:
        status, headers, _ = request(
            "OPTIONS",
            f"{api}/api/analyze",
            headers={
                "Origin": origin,
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type",
            },
        )
        allow = {k.lower(): v for k, v in headers.items()}.get("access-control-allow-origin")
        ok = status in (200, 204) and allow in (origin, "*")
        detail = f"HTTP {status}, Access-Control-Allow-Origin={allow!r}"
        if not ok:
            detail += f"  -> add {origin} to CORS_ALLOWED_ORIGINS on the backend"
        return report("CORS preflight", ok, t, detail)
    except Exception as exc:  # noqa: BLE001
        return report("CORS preflight", False, t, repr(exc))


def check_analyze(api: str, origin: str) -> bool:
    t = time.perf_counter()
    departure = (datetime.now(timezone.utc) + timedelta(hours=2)).replace(microsecond=0)
    payload = {
        "origin": {"lat": 32.7767, "lng": -96.797, "label": "Dallas, TX, USA"},
        "destination": {"lat": 39.7392, "lng": -104.9903, "label": "Denver, CO, USA"},
        "departure_time": departure.isoformat(),
        "load_weight_lb": 38000,
        "interval_miles": 25,
    }
    try:
        status, _, body = request(
            "POST",
            f"{api}/api/analyze",
            headers={"Content-Type": "application/json", "Origin": origin},
            body=payload,
        )
        if status != 200:
            return report("analyze Dallas -> Denver", False, t, f"HTTP {status} {body[:160]}")
        routes = json.loads(body).get("routes", [])
        ok = bool(routes) and all(r.get("checkpoints") for r in routes)
        names = "; ".join(f"{r.get('summary')} ({r.get('delta_label')})" for r in routes)
        return report("analyze Dallas -> Denver", ok, t, f"{len(routes)} route(s): {names}")
    except Exception as exc:  # noqa: BLE001
        return report("analyze Dallas -> Denver", False, t, repr(exc))


def main(argv: list[str]) -> int:
    if len(argv) != 3:
        print(__doc__)
        return 2
    api, front = argv[1].rstrip("/"), argv[2].rstrip("/")
    print(f"backend  {api}\nfrontend {front}\n")
    results = [check_health(api), check_cors(api, front), check_analyze(api, front)]
    print("\nALL PASS" if all(results) else "\nSOME CHECKS FAILED")
    return 0 if all(results) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
