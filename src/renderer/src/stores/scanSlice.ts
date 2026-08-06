import type { StateCreator } from 'zustand'
import type { QuickScanSummary, ScanResult, UndoAvailability } from '@shared/types'
import type { OrdinoError } from '@shared/errors'
import { ordino } from '../api/client'
import type { AppState } from './index'

export interface ScanSlice {
  rootPath: string | null
  quick: QuickScanSummary | null
  scanResult: ScanResult | null
  scanning: boolean
  scanError: OrdinoError | null
  /** Crash recovery: a previous apply on this folder never finished (P0-7). */
  undoStatus: UndoAvailability | null
  /** Set the folder (from picker or drop) and kick off quick + full scans. */
  selectFolder: (rootPath: string) => Promise<void>
  clearScan: () => void
}

export const createScanSlice: StateCreator<AppState, [], [], ScanSlice> = (set, get) => ({
  rootPath: null,
  quick: null,
  scanResult: null,
  scanning: false,
  scanError: null,
  undoStatus: null,

  selectFolder: async (rootPath) => {
    set({ rootPath, quick: null, scanResult: null, scanning: true, scanError: null, undoStatus: null })
    get().resetInclusion()
    get().setReorganizeEverything(false)
    get().goTo('scan')

    const quickRes = await ordino.invoke('scan:quick', { rootPath })
    if (!quickRes.ok) {
      set({ scanning: false, scanError: quickRes.error })
      return
    }
    // A later selectFolder may have superseded this one.
    if (get().rootPath !== rootPath) return
    set({ quick: quickRes.data })

    const [fullRes, prefsRes, undoRes] = await Promise.all([
      ordino.invoke('scan:folder', { rootPath }),
      ordino.invoke('prefs:getFolder', { rootPath }),
      ordino.invoke('undo:status', { rootPath })
    ])
    if (get().rootPath !== rootPath) return
    if (!fullRes.ok) {
      set({ scanning: false, scanError: fullRes.error })
      return
    }
    set({
      scanning: false,
      scanResult: fullRes.data,
      undoStatus: undoRes.ok ? undoRes.data : null
    })

    // P1-4: remembered per-folder prefs win over global defaults.
    if (prefsRes.ok && prefsRes.data) {
      const prefs = prefsRes.data
      if (prefs.strategy) get().setStrategy(prefs.strategy)
      if (prefs.inclusionChoices) get().resetInclusion(prefs.inclusionChoices)
    }
  },

  clearScan: () =>
    set({
      rootPath: null,
      quick: null,
      scanResult: null,
      scanning: false,
      scanError: null,
      undoStatus: null
    })
})
