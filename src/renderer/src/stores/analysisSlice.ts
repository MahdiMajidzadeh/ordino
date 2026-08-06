import type { StateCreator } from 'zustand'
import type { AnalysisProgress, DuplicatesProgress, Plan, RerunDiff } from '@shared/types'
import type { OrdinoError } from '@shared/errors'
import { ordino } from '../api/client'
import type { AppState } from './index'

export interface AnalysisSlice {
  analysisJobId: string | null
  analysisProgress: AnalysisProgress | null
  duplicatesProgress: DuplicatesProgress | null
  analysisError: OrdinoError | null
  /** Result of the fast path — "already organized". */
  nothingToDo: RerunDiff | null
  plan: Plan | null
  startAnalysis: () => Promise<void>
  cancelAnalysis: () => Promise<void>
  clearAnalysis: () => void
}

export const createAnalysisSlice: StateCreator<AppState, [], [], AnalysisSlice> = (set, get) => ({
  analysisJobId: null,
  analysisProgress: null,
  duplicatesProgress: null,
  analysisError: null,
  nothingToDo: null,
  plan: null,

  startAnalysis: async () => {
    const scan = get().scanResult
    if (!scan) return
    set({
      analysisJobId: null,
      analysisProgress: null,
      duplicatesProgress: null,
      analysisError: null,
      nothingToDo: null,
      plan: null
    })
    get().goTo('analyzing')

    // P1-4: remember the choices that produced this analysis (best-effort).
    void ordino.invoke('prefs:setFolder', {
      rootPath: scan.rootPath,
      prefs: { strategy: get().strategy, inclusionChoices: get().inclusionChoices }
    })
    void ordino.invoke('settings:set', { lastStrategy: get().strategy })

    const offAnalysis = ordino.on('analysis:progress', (p) => {
      set({ analysisJobId: p.jobId, analysisProgress: p })
    })
    const offDuplicates = ordino.on('duplicates:progress', (p) => {
      set({ duplicatesProgress: p })
    })

    try {
      const res = await ordino.invoke('analysis:start', {
        scanId: scan.scanId,
        strategy: get().strategy,
        inclusionChoices: get().inclusionChoices,
        reorganizeEverything: get().reorganizeEverything
      })
      if (!res.ok) {
        if (res.error.code === 'ANALYSIS_CANCELLED') return // user backed out
        set({ analysisError: res.error })
        return
      }
      if (res.data.nothingToDo) {
        set({ nothingToDo: res.data.rerun })
        return
      }
      set({ plan: res.data.plan })
      get().initPlanDecisions(res.data.plan)
      get().goTo('review')
    } finally {
      offAnalysis()
      offDuplicates()
      set({ analysisJobId: null })
    }
  },

  cancelAnalysis: async () => {
    const jobId = get().analysisJobId
    if (jobId) await ordino.invoke('job:cancel', { jobId })
    get().goTo('strategy')
  },

  clearAnalysis: () =>
    set({
      analysisJobId: null,
      analysisProgress: null,
      duplicatesProgress: null,
      analysisError: null,
      nothingToDo: null,
      plan: null
    })
})
