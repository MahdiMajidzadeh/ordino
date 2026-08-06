import type { StateCreator } from 'zustand'
import type { ApplyProgress, ApplyResult, UndoResult } from '@shared/types'
import type { OrdinoError } from '@shared/errors'
import { ordino } from '../api/client'
import { effectiveMovesOf } from './planSlice'
import type { AppState } from './index'

export interface ApplySlice {
  applyProgress: ApplyProgress | null
  applyResult: ApplyResult | null
  applyError: OrdinoError | null
  undoResult: UndoResult | null
  undoRunning: boolean
  startApply: () => Promise<void>
  undoLastApply: () => Promise<void>
}

export const createApplySlice: StateCreator<AppState, [], [], ApplySlice> = (set, get) => ({
  applyProgress: null,
  applyResult: null,
  applyError: null,
  undoResult: null,
  undoRunning: false,

  startApply: async () => {
    const { plan, scanResult, decisions, dupeChoices, strategy } = get()
    if (!plan || !scanResult) return

    const moves = effectiveMovesOf(plan, decisions, dupeChoices)
      .filter((m) => m.included)
      .map((m) => ({ fileId: m.fileId, source: m.source, destination: m.destination }))
    const trash = scanResult.files
      .filter((f) => dupeChoices[f.id] === 'trash')
      .map((f) => ({ fileId: f.id, path: f.relPath }))
    const existingDirs = new Set(scanResult.dirs.map((d) => d.relPath))
    const newFolders = [
      ...new Set(
        moves
          .map((m) => (m.destination.includes('/') ? m.destination.slice(0, m.destination.lastIndexOf('/')) : ''))
          .filter((d) => d !== '' && !existingDirs.has(d))
      )
    ].sort()

    set({ applyProgress: null, applyResult: null, applyError: null, undoResult: null })
    get().goTo('applying')

    const off = ordino.on('apply:progress', (p) => set({ applyProgress: p }))
    try {
      const res = await ordino.invoke('apply:start', {
        rootPath: scanResult.rootPath,
        planId: plan.planId,
        strategy,
        moves,
        trash,
        newFolders
      })
      if (!res.ok) {
        set({ applyError: res.error })
        get().goTo('done')
        return
      }
      set({ applyResult: res.data })
      get().goTo('done')
    } finally {
      off()
    }
  },

  undoLastApply: async () => {
    const rootPath = get().scanResult?.rootPath ?? get().rootPath
    if (!rootPath) return
    set({ undoRunning: true, undoResult: null })
    const off = ordino.on('apply:progress', (p) => set({ applyProgress: p }))
    try {
      const res = await ordino.invoke('undo:last', { rootPath })
      if (!res.ok) {
        set({ applyError: res.error })
        return
      }
      set({ undoResult: res.data })
    } finally {
      off()
      set({ undoRunning: false })
    }
  }
})
