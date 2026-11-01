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

## Third-party APIs
- [OpenRouteService](https://openrouteservice.org/) – geocoding and directions (needs `ORS_API_KEY`)
- [Open-Meteo](https://open-meteo.com/) – weather forecasts (no key)
- [OpenFreeMap](https://openfreemap.org/) – vector map tiles/styles (no key)
