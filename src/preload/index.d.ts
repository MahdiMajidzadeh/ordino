import type { OrdinoApi } from '../shared/ordino-api'

declare global {
  interface Window {
    /** Absent in browser-only dev; the renderer falls back to the mock API. */
    ordino?: OrdinoApi
  }
}

export {}
