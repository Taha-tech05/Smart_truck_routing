/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string
  readonly VITE_MAP_STYLE_URL: string
  readonly VITE_MAP_STYLE_DARK_URL?: string
  readonly VITE_USE_MOCKS?: string
  readonly VITE_DEBUG_HEATMAP?: string
}
