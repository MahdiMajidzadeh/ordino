import type { StateCreator } from 'zustand'
import {
  DEFAULT_STRATEGY,
  isStrategyConfigValid,
  type DateGranularity,
  type StrategyConfig,
  type StrategyId
} from '@shared/strategies'
import type { AppState } from './index'

export interface StrategySlice {
  strategy: StrategyConfig
  /** §5.7 escape hatch — ignore the manifest and re-plan everything. */
  reorganizeEverything: boolean
  setStrategyId: (id: StrategyId) => void
  setDateGranularity: (g: DateGranularity) => void
  setCustomInstruction: (text: string) => void
  setReuseExisting: (reuse: boolean) => void
  setReorganizeEverything: (value: boolean) => void
  setStrategy: (strategy: StrategyConfig) => void
  strategyIsValid: () => boolean
}

export const createStrategySlice: StateCreator<AppState, [], [], StrategySlice> = (set, get) => ({
  strategy: DEFAULT_STRATEGY,
  reorganizeEverything: false,

  setStrategyId: (id) =>
    set((s) => ({
      strategy: {
        ...s.strategy,
        id,
        dateGranularity: id === 'date' ? (s.strategy.dateGranularity ?? 'year') : s.strategy.dateGranularity
      }
    })),
  setDateGranularity: (dateGranularity) => set((s) => ({ strategy: { ...s.strategy, dateGranularity } })),
  setCustomInstruction: (customInstruction) =>
    set((s) => ({ strategy: { ...s.strategy, customInstruction } })),
  setReuseExisting: (reuseExistingFolders) =>
    set((s) => ({ strategy: { ...s.strategy, reuseExistingFolders } })),
  setReorganizeEverything: (reorganizeEverything) => set({ reorganizeEverything }),
  setStrategy: (strategy) => set({ strategy }),
  strategyIsValid: () => isStrategyConfigValid(get().strategy)
})
