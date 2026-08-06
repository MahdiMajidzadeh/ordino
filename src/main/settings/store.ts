import { app } from 'electron'
import { join } from 'path'
import { z } from 'zod'
import type { GlobalSettings } from '@shared/types'
import { DEFAULT_STRATEGY } from '@shared/strategies'
import { DEFAULT_CLAUDE_MODEL } from '@shared/models'
import { DEFAULT_IGNORE_GLOBS } from '../scanner/globs'
import { readJson, writeJsonAtomic } from '../util/atomic-write'
import { OrdinoFailure } from '../util/failure'

const strategySchema = z.object({
  id: z.enum(['smart', 'fileType', 'date', 'custom']),
  dateGranularity: z.enum(['year', 'year-month']).optional(),
  customInstruction: z.string().optional(),
  reuseExistingFolders: z.boolean()
})

const settingsSchema = z.object({
  version: z.number(),
  provider: z.enum(['claude-cli', 'openai-compat']),
  claude: z.object({
    model: z.string(),
    cliPathOverride: z.string(),
    hasApiKeyOverride: z.boolean()
  }),
  openaiCompat: z.object({
    baseUrl: z.string(),
    model: z.string(),
    hasKey: z.boolean()
  }),
  ignoreGlobs: z.array(z.string()),
  lastStrategy: strategySchema
})

const DEFAULTS: GlobalSettings = {
  version: 1,
  provider: 'claude-cli',
  claude: { model: DEFAULT_CLAUDE_MODEL, cliPathOverride: '', hasApiKeyOverride: false },
  openaiCompat: { baseUrl: '', model: '', hasKey: false },
  ignoreGlobs: [...DEFAULT_IGNORE_GLOBS],
  lastStrategy: DEFAULT_STRATEGY
}

/**
 * Linear migrations, index = from-version. Empty today; the machinery exists
 * from day one so schema changes never strand a user's settings file.
 */
const MIGRATIONS: Array<(old: Record<string, unknown>) => Record<string, unknown>> = []

let cached: GlobalSettings | null = null

function settingsPath(): string {
  return join(app.getPath('userData'), 'settings.json')
}

export async function getSettings(): Promise<GlobalSettings> {
  if (cached) return cached
  const raw = await readJson<Record<string, unknown>>(settingsPath())
  if (!raw) {
    cached = { ...DEFAULTS }
    return cached
  }
  let migrated = raw
  let version = typeof raw.version === 'number' ? raw.version : 1
  while (version < DEFAULTS.version) {
    const migrate = MIGRATIONS[version - 1]
    if (!migrate) break
    migrated = migrate(migrated)
    version += 1
  }
  const parsed = settingsSchema.safeParse({ ...DEFAULTS, ...migrated, version: DEFAULTS.version })
  cached = parsed.success ? parsed.data : { ...DEFAULTS }
  return cached
}

export async function updateSettings(patch: Partial<GlobalSettings>): Promise<GlobalSettings> {
  const current = await getSettings()
  const next: GlobalSettings = {
    ...current,
    ...patch,
    version: DEFAULTS.version,
    claude: { ...current.claude, ...(patch.claude ?? {}) },
    openaiCompat: { ...current.openaiCompat, ...(patch.openaiCompat ?? {}) }
  }
  const valid = settingsSchema.safeParse(next)
  if (!valid.success) {
    throw new OrdinoFailure('INVALID_REQUEST', 'Settings patch failed validation', {
      detail: valid.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
    })
  }
  try {
    await writeJsonAtomic(settingsPath(), valid.data)
  } catch (e) {
    throw new OrdinoFailure('SETTINGS_WRITE_FAILED', 'Could not save settings', {
      retryable: true,
      detail: e instanceof Error ? e.message : undefined
    })
  }
  cached = valid.data
  return cached
}
