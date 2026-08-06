export type StrategyId = 'smart' | 'fileType' | 'date' | 'custom'

export type DateGranularity = 'year' | 'year-month'

export interface StrategyConfig {
  id: StrategyId
  /** Only meaningful when id === 'date'. */
  dateGranularity?: DateGranularity
  /** Only meaningful when id === 'custom'; passed verbatim to the model. */
  customInstruction?: string
  /** Prefer slotting files into existing subfolders instead of creating new ones. */
  reuseExistingFolders: boolean
}

export const STRATEGY_IDS: readonly StrategyId[] = ['smart', 'fileType', 'date', 'custom']

export const DEFAULT_STRATEGY: StrategyConfig = {
  id: 'smart',
  reuseExistingFolders: true
}

export function isStrategyConfigValid(s: StrategyConfig): boolean {
  if (s.id === 'custom') return (s.customInstruction ?? '').trim().length > 0
  if (s.id === 'date') return s.dateGranularity === 'year' || s.dateGranularity === 'year-month'
  return true
}

/**
 * Two runs "mix strategies" (worth a warning, §5.7) when the strategy family
 * differs — granularity/instruction tweaks within a family do not count.
 */
export function strategiesConflict(a: StrategyConfig, b: StrategyConfig): boolean {
  return a.id !== b.id
}
