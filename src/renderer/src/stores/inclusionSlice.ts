import type { StateCreator } from 'zustand'
import type { InclusionChoice } from '@shared/types'
import { setAll, toggleDir } from '../lib/inclusion'
import type { AppState } from './index'

export interface InclusionSlice {
  /** Only explicit user choices; inheritance is computed (lib/inclusion). */
  inclusionChoices: Record<string, InclusionChoice>
  toggleInclusion: (dirPath: string, next: boolean) => void
  includeAllDirs: () => void
  skipAllDirs: () => void
  resetInclusion: (choices?: Record<string, InclusionChoice>) => void
}

export const createInclusionSlice: StateCreator<AppState, [], [], InclusionSlice> = (set, get) => ({
  inclusionChoices: {},

  toggleInclusion: (dirPath, next) =>
    set({ inclusionChoices: toggleDir(dirPath, next, get().inclusionChoices) }),

  includeAllDirs: () => set({ inclusionChoices: {} }),

  skipAllDirs: () => {
    const dirs = get().scanResult?.dirs ?? []
    set({ inclusionChoices: setAll(dirs, 'skip') })
  },

  resetInclusion: (choices) => set({ inclusionChoices: choices ?? {} })
})
