import { getSettings } from '../settings/store'
import { getApiKey } from '../settings/secrets'
import { OrdinoFailure } from '../util/failure'
import { OpenAiCompatProvider } from './openai-compat'
import { ClaudeCliProvider } from './claude-cli'
import type { OrganizerProvider } from './types'

/** Build the configured provider from settings + keychain. */
export async function createConfiguredProvider(): Promise<OrganizerProvider> {
  const settings = await getSettings()

  if (settings.provider === 'openai-compat') {
    if (!settings.openaiCompat.baseUrl.trim() || !settings.openaiCompat.model.trim()) {
      throw new OrdinoFailure(
        'PROVIDER_NOT_CONFIGURED',
        'OpenAI-compatible endpoint is not configured yet'
      )
    }
    const apiKey = await getApiKey('openai-compat')
    return new OpenAiCompatProvider({
      baseUrl: settings.openaiCompat.baseUrl,
      model: settings.openaiCompat.model,
      apiKey
    })
  }

  const apiKey = settings.claude.hasApiKeyOverride ? await getApiKey('claude-cli') : null
  return await ClaudeCliProvider.create({
    model: settings.claude.model,
    cliPathOverride: settings.claude.cliPathOverride,
    apiKey
  })
}
