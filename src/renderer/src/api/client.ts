import type { OrdinoApi } from '@shared/ordino-api'
import { createMockOrdino } from './mock/mockOrdino'

/**
 * The one place the renderer touches the outside world. Inside Electron the
 * preload bridge exists; in browser-only dev (vite serving the renderer alone)
 * the mock takes over.
 */
export const ordino: OrdinoApi = window.ordino ?? createMockOrdino()

export const usingMock = !window.ordino
