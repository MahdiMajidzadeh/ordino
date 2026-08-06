import { create } from 'zustand'
import { createWizardSlice, type WizardSlice } from './wizardSlice'
import { createScanSlice, type ScanSlice } from './scanSlice'
import { createInclusionSlice, type InclusionSlice } from './inclusionSlice'
import { createStrategySlice, type StrategySlice } from './strategySlice'
import { createAnalysisSlice, type AnalysisSlice } from './analysisSlice'
import { createPlanSlice, type PlanSlice } from './planSlice'
import { createApplySlice, type ApplySlice } from './applySlice'
import { createSettingsSlice, type SettingsSlice } from './settingsSlice'

/**
 * One store, slice pattern — cross-slice actions (reset flows, guarded
 * transitions) can reach everything through get().
 */
export type AppState = WizardSlice &
  ScanSlice &
  InclusionSlice &
  StrategySlice &
  AnalysisSlice &
  PlanSlice &
  ApplySlice &
  SettingsSlice

export const useApp = create<AppState>()((...a) => ({
  ...createWizardSlice(...a),
  ...createScanSlice(...a),
  ...createInclusionSlice(...a),
  ...createStrategySlice(...a),
  ...createAnalysisSlice(...a),
  ...createPlanSlice(...a),
  ...createApplySlice(...a),
  ...createSettingsSlice(...a)
}))
