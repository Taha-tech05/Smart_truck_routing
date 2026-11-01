/**
 * MapLibre GL setup.
 *
 * maplibre-gl v6 ships its web worker as a separate file
 * (`dist/maplibre-gl-worker.mjs`) and no longer inlines it, so Vite cannot
 * discover its URL on its own and the map fails with a worker-load error.
 * We import the worker with Vite's `?url` suffix (which emits the file and
 * returns its public URL in both dev and build) and register it explicitly.
 *
 * Always import maplibre from this module, never from 'maplibre-gl' directly,
 * so the worker URL is guaranteed to be set before any Map is created.
 */
import { setWorkerUrl } from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import 'maplibre-gl/dist/maplibre-gl.css'

setWorkerUrl(workerUrl)

export * from 'maplibre-gl'
