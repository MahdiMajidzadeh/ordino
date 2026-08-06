import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import { randomBytes } from 'crypto'

/**
 * Crash-safe JSON write: temp file in the same dir → fsync → rename. Used for
 * every piece of persistent state (journal, manifest, settings) so a crash
 * mid-write can never corrupt the previous good version.
 */
export async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  const dir = dirname(path)
  await fs.mkdir(dir, { recursive: true })
  const tmp = join(dir, `.tmp-${randomBytes(6).toString('hex')}`)
  const payload = JSON.stringify(value, null, 2)
  const handle = await fs.open(tmp, 'w')
  try {
    await handle.writeFile(payload, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
  await fs.rename(tmp, path)
}

export async function readJson<T>(path: string): Promise<T | null> {
  try {
    const text = await fs.readFile(path, 'utf8')
    return JSON.parse(text) as T
  } catch {
    return null
  }
}
