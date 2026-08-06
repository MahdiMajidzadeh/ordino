import { z } from 'zod'
import { handle } from '../typed-ipc'
import { getSettings, updateSettings } from '../../settings/store'
import { clearApiKey, setApiKey } from '../../settings/secrets'

const providerIdSchema = z.enum(['claude-cli', 'openai-compat'])

export function registerSettingsHandlers(): void {
  handle('settings:get', null, () => getSettings())

  // The renderer can never set hasKey flags directly — those flip only via
  // the secrets handlers below.
  handle('settings:set', z.record(z.string(), z.unknown()) as never, async (patch) => {
    const clean = { ...patch } as Record<string, unknown>
    if (typeof clean.claude === 'object' && clean.claude !== null) {
      delete (clean.claude as Record<string, unknown>).hasApiKeyOverride
    }
    if (typeof clean.openaiCompat === 'object' && clean.openaiCompat !== null) {
      delete (clean.openaiCompat as Record<string, unknown>).hasKey
    }
    return updateSettings(clean)
  })

  handle(
    'secrets:setKey',
    z.object({ provider: providerIdSchema, apiKey: z.string().min(1) }),
    async ({ provider, apiKey }) => {
      await setApiKey(provider, apiKey)
      if (provider === 'claude-cli') await updateSettings({ claude: { hasApiKeyOverride: true } } as never)
      else await updateSettings({ openaiCompat: { hasKey: true } } as never)
    }
  )

  handle('secrets:clearKey', z.object({ provider: providerIdSchema }), async ({ provider }) => {
    await clearApiKey(provider)
    if (provider === 'claude-cli') await updateSettings({ claude: { hasApiKeyOverride: false } } as never)
    else await updateSettings({ openaiCompat: { hasKey: false } } as never)
  })
}
