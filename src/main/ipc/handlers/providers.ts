import { z } from 'zod'
import type { ModelListResult, TestConnectionResult } from '@shared/types'
import { CLAUDE_MODELS } from '@shared/models'
import { handle } from '../typed-ipc'
import { getSettings } from '../../settings/store'
import { getApiKey } from '../../settings/secrets'
import { detectClaudeCli } from '../../providers/detect-claude'
import { ClaudeCliProvider } from '../../providers/claude-cli'
import { OpenAiCompatProvider } from '../../providers/openai-compat'
import { networkReady } from '../../util/net-bootstrap'

const testSchema = z.discriminatedUnion('provider', [
  z.object({
    provider: z.literal('claude-cli'),
    model: z.string().min(1),
    apiKey: z.string().optional()
  }),
  z.object({
    provider: z.literal('openai-compat'),
    baseUrl: z.string().min(1),
    model: z.string().min(1),
    apiKey: z.string().optional(),
    useStoredKey: z.boolean().optional()
  })
])

const listSchema = z.discriminatedUnion('provider', [
  z.object({ provider: z.literal('claude-cli') }),
  z.object({
    provider: z.literal('openai-compat'),
    baseUrl: z.string().min(1),
    apiKey: z.string().optional(),
    useStoredKey: z.boolean().optional()
  })
])

export function registerProviderHandlers(): void {
  handle('provider:detectClaude', null, async () => {
    // Detection resolves `claude` through PATH, which is only complete once
    // the shell environment has been adopted.
    await networkReady()
    const settings = await getSettings()
    return detectClaudeCli(settings.claude.cliPathOverride)
  })

  handle('provider:testConnection', testSchema as never, async (req): Promise<TestConnectionResult> => {
    await networkReady()
    const settings = await getSettings()
    if (req.provider === 'claude-cli') {
      // Explicit key from the form wins; else the stored override; else the
      // CLI's own sign-in.
      const apiKey =
        req.apiKey ?? (settings.claude.hasApiKeyOverride ? await getApiKey('claude-cli') : null)
      const provider = await ClaudeCliProvider.create({
        model: req.model,
        cliPathOverride: settings.claude.cliPathOverride,
        apiKey
      })
      return provider.testConnection()
    }
    const apiKey = req.apiKey ?? (req.useStoredKey ? await getApiKey('openai-compat') : null)
    const provider = new OpenAiCompatProvider({ baseUrl: req.baseUrl, model: req.model, apiKey })
    return provider.testConnection()
  })

  handle('provider:listModels', listSchema as never, async (req): Promise<ModelListResult> => {
    if (req.provider === 'claude-cli') {
      return { models: CLAUDE_MODELS.map((m) => m.id), source: 'curated' }
    }
    const apiKey = req.apiKey ?? (req.useStoredKey ? await getApiKey('openai-compat') : null)
    const provider = new OpenAiCompatProvider({
      baseUrl: req.baseUrl,
      model: 'unused-for-listing',
      apiKey
    })
    return provider.listModels()
  })
}
