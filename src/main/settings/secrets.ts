import { app, safeStorage } from 'electron'
import { join } from 'path'
import type { ProviderId } from '@shared/types'
import { readJson, writeJsonAtomic } from '../util/atomic-write'
import { OrdinoFailure } from '../util/failure'

/**
 * API keys encrypted with the OS keychain via safeStorage, stored as base64
 * ciphertext in userData/secrets.json. Keys are decrypted only in main at
 * call time and NEVER cross IPC toward the renderer — the renderer only sees
 * hasKey booleans in settings.
 */
type SecretsFile = Partial<Record<ProviderId, string>>

function secretsPath(): string {
  return join(app.getPath('userData'), 'secrets.json')
}

function assertAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new OrdinoFailure('SECRET_STORE_UNAVAILABLE', 'System keychain is not available')
  }
}

export async function setApiKey(provider: ProviderId, apiKey: string): Promise<void> {
  assertAvailable()
  const file = (await readJson<SecretsFile>(secretsPath())) ?? {}
  file[provider] = safeStorage.encryptString(apiKey).toString('base64')
  await writeJsonAtomic(secretsPath(), file)
}

export async function clearApiKey(provider: ProviderId): Promise<void> {
  const file = (await readJson<SecretsFile>(secretsPath())) ?? {}
  delete file[provider]
  await writeJsonAtomic(secretsPath(), file)
}

export async function getApiKey(provider: ProviderId): Promise<string | null> {
  const file = (await readJson<SecretsFile>(secretsPath())) ?? {}
  const stored = file[provider]
  if (!stored) return null
  try {
    return safeStorage.decryptString(Buffer.from(stored, 'base64'))
  } catch {
    return null // encrypted under a different OS user/keychain — treat as absent
  }
}

/** Linux: warn when safeStorage falls back to plaintext-equivalent storage. */
export function usingWeakBackend(): boolean {
  return (
    process.platform === 'linux' &&
    'getSelectedStorageBackend' in safeStorage &&
    safeStorage.getSelectedStorageBackend() === 'basic_text'
  )
}
