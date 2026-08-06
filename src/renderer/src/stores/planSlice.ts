import type { StateCreator } from 'zustand'
import type { Plan, PlanMove } from '@shared/types'
import type { AppState } from './index'

export interface PlanDecision {
  included: boolean
  /** P1-1 reassignment; undefined = keep the AI's destination. */
  destFolderOverride?: string
}

export type DupeChoice = 'keep' | 'trash'

export interface EffectiveMove extends PlanMove {
  included: boolean
  edited: boolean
}

export interface PlanSlice {
  /** Per-file decisions, keyed by fileId. Only moves have entries. */
  decisions: Record<string, PlanDecision>
  /** Keep/Trash per duplicate file — default keep, trashing is opt-in (P0-8). */
  dupeChoices: Record<string, DupeChoice>
  initPlanDecisions: (plan: Plan) => void
  toggleMoveIncluded: (fileId: string, next: boolean) => void
  setMoveOverride: (fileId: string, destFolder: string | null) => void
  setDupeChoice: (fileId: string, choice: DupeChoice) => void
  /** Group action: include/exclude every move targeting a folder. */
  setFolderApproval: (destFolder: string, included: boolean) => void

  // ---- review-screen UI state ----
  hoveredFileId: string | null
  /** Selected row: file for the detail card / persistent connector, or folder for group lines. */
  selectedRowId: string | null
  focusedRowId: string | null
  expandedLeft: ReadonlySet<string>
  expandedRight: ReadonlySet<string>
  reviewExpansionInitialized: boolean
  setHoveredFileId: (id: string | null) => void
  setSelectedRowId: (id: string | null) => void
  setFocusedRowId: (id: string | null) => void
  toggleExpandLeft: (rowId: string) => void
  toggleExpandRight: (rowId: string) => void
  setExpandedRight: (next: ReadonlySet<string>) => void
  initReviewExpansion: (left: ReadonlySet<string>, right: ReadonlySet<string>) => void
}

export function effectiveMovesOf(
  plan: Plan,
  decisions: Record<string, PlanDecision>,
  dupeChoices: Record<string, DupeChoice>
): EffectiveMove[] {
  return plan.moves.map((move) => {
    const decision = decisions[move.fileId]
    const trashed = dupeChoices[move.fileId] === 'trash'
    const destFolder = decision?.destFolderOverride ?? move.destFolder
    const name = move.source.split('/').pop()!
    return {
      ...move,
      destFolder,
      destination: destFolder === '' ? name : `${destFolder}/${name}`,
      included: (decision?.included ?? true) && !trashed,
      edited: decision?.destFolderOverride !== undefined
    }
  })
}

export const createPlanSlice: StateCreator<AppState, [], [], PlanSlice> = (set, get) => ({
  decisions: {},
  dupeChoices: {},

  initPlanDecisions: (plan) => {
    const decisions: Record<string, PlanDecision> = {}
    for (const move of plan.moves) decisions[move.fileId] = { included: true }
    const dupeChoices: Record<string, DupeChoice> = {}
    for (const group of plan.duplicateGroups) {
      for (const fileId of group.fileIds) dupeChoices[fileId] = 'keep'
    }
    set({
      decisions,
      dupeChoices,
      hoveredFileId: null,
      selectedRowId: null,
      focusedRowId: null,
      expandedLeft: new Set<string>(),
      expandedRight: new Set<string>(),
      reviewExpansionInitialized: false
    })
  },

  toggleMoveIncluded: (fileId, next) =>
    set((s) => ({
      decisions: { ...s.decisions, [fileId]: { ...s.decisions[fileId], included: next } }
    })),

  setMoveOverride: (fileId, destFolder) =>
    set((s) => {
      const current = s.decisions[fileId] ?? { included: true }
      const next = { ...current }
      if (destFolder === null) delete next.destFolderOverride
      else next.destFolderOverride = destFolder
      return { decisions: { ...s.decisions, [fileId]: next } }
    }),

  setDupeChoice: (fileId, choice) =>
    set((s) => ({ dupeChoices: { ...s.dupeChoices, [fileId]: choice } })),

  setFolderApproval: (destFolder, included) => {
    const plan = get().plan
    if (!plan) return
    set((s) => {
      const decisions = { ...s.decisions }
      for (const move of effectiveMovesOf(plan, s.decisions, s.dupeChoices)) {
        if (move.destFolder === destFolder) {
          decisions[move.fileId] = { ...decisions[move.fileId], included }
        }
      }
      return { decisions }
    })
  },

  hoveredFileId: null,
  selectedRowId: null,
  focusedRowId: null,
  expandedLeft: new Set<string>(),
  expandedRight: new Set<string>(),
  reviewExpansionInitialized: false,

  setHoveredFileId: (hoveredFileId) => set({ hoveredFileId }),
  setSelectedRowId: (selectedRowId) => set({ selectedRowId }),
  setFocusedRowId: (focusedRowId) => set({ focusedRowId }),
  toggleExpandLeft: (rowId) =>
    set((s) => {
      const next = new Set(s.expandedLeft)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return { expandedLeft: next }
    }),
  toggleExpandRight: (rowId) =>
    set((s) => {
      const next = new Set(s.expandedRight)
      if (next.has(rowId)) next.delete(rowId)
      else next.add(rowId)
      return { expandedRight: next }
    }),
  setExpandedRight: (expandedRight) => set({ expandedRight }),
  initReviewExpansion: (expandedLeft, expandedRight) =>
    set({ expandedLeft, expandedRight, reviewExpansionInitialized: true })
})
