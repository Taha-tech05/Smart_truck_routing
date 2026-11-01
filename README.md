# Weather-Aware Truck Routing

Monorepo: Django REST backend + React/Vite/TypeScript frontend.

```
backend/    Django + DRF (project "config", app "routing")
frontend/   React + Vite + TypeScript + Tailwind + MapLibre
design/     Reference images
```

## Backend setup
Requires Python 3.11+.

```bash
cd backend
python -m venv venv
# Windows (PowerShell):  .\venv\Scripts\Activate.ps1
# Windows (Git Bash):    source venv/Scripts/activate
# macOS/Linux:           source venv/bin/activate
pip install -r requirements.txt
cp .env.example .env        # then edit values (set ORS_API_KEY)
python manage.py runserver  # http://localhost:8000
```
Health check: `GET http://localhost:8000/api/health` -> `{"status": "ok"}`  
Tests: `pytest`

## Frontend setup
Requires Node 20+.

```bash
cd frontend
npm install
cp .env.example .env
npm run dev                 # http://localhost:5173
```

## Backend architecture

```
backend/routing/
  constants.py            single source of truth (units, intervals, base URLs, timeouts)
  errors.py               unified error envelope {"error": {"code", "message"}}
  serializers.py          request validation (DRF)
  views.py / urls.py      GET /api/health, GET /api/geocode, POST /api/analyze
  services/
    geocoding.py          ORS geocode + autocomplete            (HTTP)
    routing_client.py     ORS directions, alternatives fallback (HTTP)
    weather_client.py     Open-Meteo, batching + cache          (HTTP)
    checkpoints.py        sampling, ETA, coverage               (pure)
    risk.py               threshold + load rules                (pure)
    recommend.py          route stats, ranking, explanation     (pure)
    analysis.py           orchestration - the only module that connects the others
```

`risk.py`, `checkpoints.py` and `recommend.py` are pure (no I/O, no Django). All HTTP uses
`httpx` with 10 s timeouts and lives only in the three client files. Units are miles, mph,
inches/hr and pounds; conversion happens at the boundary (Open-Meteo is asked for mph/inches;
ORS metres are converted to miles in `routing_client`). Tests never touch the network
(`respx` mocks + JSON fixtures in `routing/tests/fixtures/`).

### Endpoints
- `GET /api/geocode?q=...` - place suggestions `[{label, lat, lng}]` (max 5)
- `POST /api/analyze` - `{origin, destination, departure_time (ISO 8601 with tz), load_weight_lb (0-120000), interval_miles (10|25|50, default 25)}`.
  Returns ranked routes with per-checkpoint weather and risk, a recommendation and warnings.
  Departure must be at most 1 hour in the past and at most 7 days ahead.
- Errors: 400 validation, 429 rate-limit passthrough, 502 upstream failure.

### Risk boundary convention
- Wind (mph, lower bound inclusive): `<25` Low, `25-<35` Moderate, `35-<45` High, `45-<55` Severe, `>=55` No Travel.
- Rain (in/hr, upper bound inclusive): `<0.10` Low, `0.10-0.25` Moderate, `>0.25-0.50` High, `>0.50-1.00` Severe, `>1.00` No Travel.
- Snow (in/hr, upper bound inclusive): `<0.5` Low, `0.5-1.0` Moderate, `>1.0-2.0` High, `>2.0-3.0` Severe, `>3.0` No Travel.
- A checkpoint's level is the worst of the three, then load rules can only escalate it
  (strict `>` on load): wind >= 55 -> No Travel; wind 45-<55 and load > 30,000 lb -> No Travel;
  wind 35-<45 and load > 40,000 lb -> at least Severe.

### Checkpoint coverage method
Checkpoints are placed at mile 0, every `interval` miles, and always at the route end (a last
regular checkpoint within 1 mile of the end is dropped). ETA = departure + (mile / total miles)
x total duration. Each checkpoint **covers** the road from the midpoint to the previous
checkpoint to the midpoint to the next (first starts at 0, last ends at the route length), so
coverage tiles the route exactly. Route stats weight each checkpoint's risk by its covered miles;
routes are ranked by (has No Travel, Severe miles, High miles, average risk, duration).

### Wind metric
We use **sustained** wind (`wind_speed_10m`), not gusts, because the thresholds are defined on
sustained speed; gusts would over-classify risk. Rain uses `rain` (not total `precipitation`) to
avoid double counting snow.

### ORS alternative routes: limitation and fallback
The public ORS API supports `alternative_routes` only for routes up to roughly 100 km, so long
truck trips often return a single route. `get_routes` asks for alternatives first (retrying a
plain request if ORS rejects it); if fewer than 3 distinct routes result, it builds via-waypoints
at the route midpoint offset perpendicular by ~10% of the route length (once to each side) and
requests origin -> via -> destination. Routes are de-duplicated (>90% of sampled points within
1 mile of another route) and via-routes more than 1.5x longer than the fastest are discarded.
It returns 1-3 routes plus a `warnings` list and never fails just because fewer than 3 exist.

### Assumption: checkpoint interval
"Every 10/25/50 miles" is treated as a **user-chosen interval** (10, 25 or 50) that defaults to 25.

### Heatmap (`POST /api/heatmap`)
One response holds 48 hours of risk for a grid around a route, so the frontend time slider changes
the hour with **no further network calls**.
- **Corridor grid:** centre-line points every `spacing_miles` (10, 25 or 50) along the route, each with
  perpendicular offsets at -corridor, -corridor/2, 0, +corridor/2, +corridor miles (`corridor_miles`
  10-60, default 30), computed from the local route bearing. Points within ~7 miles of each other are
  merged, because the weather cache uses 0.1 degree cells (~7 miles) and tighter points add nothing.
- **150-point cap:** if the grid would exceed 150 points the spacing is increased automatically and a
  warning is returned. Route geometries over 5,000 vertices are simplified server-side.
- **Hours:** hour 0 is the **current UTC hour** (floored); hour 48 is two days later (49 slots). The slot
  is found by matching timestamps in the Open-Meteo arrays, not by assuming they start at the current
  hour. Missing hours are forward-filled from the previous hour (0 if none) and counted in `missing`.
- **Weather and cache:** one batched call through the same `weather_client` (chunked, concurrent, 30-minute
  cache) that `/api/analyze` uses, so overlapping points cost nothing extra.
- **Digit strings:** each point's 49 levels are sent as one string of characters `0`-`4`
  (`"0011223..."`) instead of an array of numbers. That is about 50 bytes per point instead of ~150, keeps
  150 points x 49 hours around 15 KB (limit 100 KB), and the frontend reads the level with `s[hour]`.
- Request: `{route_coordinates: [[lng, lat], ...], load_weight_lb, corridor_miles?, spacing_miles?}`.
  Response: `{start_time, hours, points: [[lat, lng, mile_along], ...], levels: [...], level_names,
  summary: [{hour, max_level, counts}], missing, warnings}`.

### Forecast limits
Open-Meteo is queried for 3 forecast days. ETAs past the end of the forecast use the last
available hour and are flagged `beyond_forecast` (with a warning).

## Third-party APIs
- [OpenRouteService](https://openrouteservice.org/) – geocoding and directions (needs `ORS_API_KEY`)
- [Open-Meteo](https://open-meteo.com/) – weather forecasts (no key)
- [OpenFreeMap](https://openfreemap.org/) – vector map tiles/styles (no key)
