import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // maplibre-gl v6 ships its worker as a separate file. It is excluded from
  // pre-bundling so the `?url` import in src/utils/maplibre.ts resolves to a
  // real, servable file URL (see that file for details).
  optimizeDeps: { exclude: ['maplibre-gl'] },
})
