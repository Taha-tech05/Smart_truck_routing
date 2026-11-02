# Deploying: Render (backend) + Vercel (frontend)

Order matters: **backend first, then frontend, then update CORS with the Vercel URL.**
Never commit secrets; enter them only in the Render / Vercel dashboards.

You need: this repo on GitHub, a free [OpenRouteService key](https://openrouteservice.org/dev/#/signup),
and a random secret string (`python -c "import secrets; print(secrets.token_urlsafe(50))"`).

## 1. Backend on Render

1. Render dashboard -> **New +** -> **Blueprint** -> connect the GitHub repo. Render reads `render.yaml` and proposes the service `truck-weather-router-api`.
2. When prompted, fill the two secret variables:
   - `SECRET_KEY` = the random string above
   - `ORS_API_KEY` = your OpenRouteService key
3. Click **Apply**. Render builds `backend/Dockerfile` and waits for `/api/health` to pass.
4. Note the service URL, e.g. `https://truck-weather-router-api.onrender.com`.
5. Open the service -> **Environment** and check:
   - `ALLOWED_HOSTS` = your Render hostname (e.g. `truck-weather-router-api.onrender.com`); comma-separate to add more. The Render hostname is also allowed automatically.
   - `CORS_ALLOWED_ORIGINS` = leave the placeholder for now (step 3 fixes it).
6. Test: open `https://<your-api>.onrender.com/api/health` -> `{"status":"ok"}`.

The free plan sleeps after ~15 minutes idle; the first request afterwards can take up to a minute.

## 2. Frontend on Vercel

1. Vercel -> **Add New... -> Project** -> import the same repo.
2. Settings on the import screen:
   - **Root Directory:** `frontend`
   - **Framework Preset:** Vite (`frontend/vercel.json` also sets it)
   - **Build Command:** `npm run build`
   - **Output Directory:** `dist`
   - **Install Command:** `npm ci`
3. **Environment Variables:**
   - `VITE_API_BASE_URL` = your Render URL, **no trailing slash** (e.g. `https://truck-weather-router-api.onrender.com`)
   - Leave `VITE_USE_MOCKS` unset (or `false`).
4. Deploy. Note the URL, e.g. `https://your-app.vercel.app`. `vercel.json` rewrites every path to `/index.html`.

`VITE_*` values are baked in at build time: if you change one, **redeploy**.

## 3. Allow the frontend in the backend (CORS)

Render -> service -> **Environment** -> set
`CORS_ALLOWED_ORIGINS` = `https://your-app.vercel.app`
(exact origin: scheme + host, no path, no trailing slash; comma-separate several, e.g. add a custom domain).
Saving triggers a redeploy.

## 4. Verify

```bash
python scripts/check_deployment.py https://<your-api>.onrender.com https://<your-app>.vercel.app
```

It checks health, the CORS preflight from your Vercel origin, and a real Dallas -> Denver analyze
(this uses a little ORS quota), printing PASS/FAIL with timings. Then open the Vercel URL and run a trip.

## Environment variable reference

| Variable | Where | Value |
| --- | --- | --- |
| `SECRET_KEY` | Render (secret) | long random string |
| `ORS_API_KEY` | Render (secret) | OpenRouteService key |
| `DEBUG` | Render | `False` (set by `render.yaml`) |
| `HTTPS_ONLY` | Render | `True` (set by `render.yaml`): redirects http -> https, Secure cookies |
| `ALLOWED_HOSTS` | Render | backend hostname(s), comma-separated |
| `CORS_ALLOWED_ORIGINS` | Render | frontend origin(s), comma-separated |
| `VITE_API_BASE_URL` | Vercel | backend URL, no trailing slash |

## Troubleshooting

- **Browser shows a CORS error:** `CORS_ALLOWED_ORIGINS` must equal the exact origin in the address bar.
- **`DisallowedHost` / HTTP 400 from the API:** add the hostname to `ALLOWED_HOSTS`.
- **Analyze says the routing service rejected the key:** wrong `ORS_API_KEY`, or the ORS daily quota is used up.
- **Frontend still calls localhost:** `VITE_API_BASE_URL` was missing at build time; set it and redeploy.
