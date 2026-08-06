/**
 * Curated model list for the Claude Code CLI backend. The CLI resolves these
 * aliases to the current model generation, so the list stays evergreen.
 */
export interface CuratedModel {
  /** Value passed to `claude --model`. */
  id: string
  labelKey: string
}

export const CLAUDE_MODELS: readonly CuratedModel[] = [
  { id: 'sonnet', labelKey: 'models.claude.sonnet' },
  { id: 'haiku', labelKey: 'models.claude.haiku' },
  { id: 'opus', labelKey: 'models.claude.opus' }
]

export const DEFAULT_CLAUDE_MODEL = 'sonnet'

export const DEFAULT_OLLAMA_BASE_URL = 'http://localhost:11434/v1'
