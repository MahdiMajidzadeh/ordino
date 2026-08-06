import { app } from 'electron'
import { promises as fs } from 'fs'
import { basename, join } from 'path'
import type { RecentFolder } from '@shared/types'
import { readJson, writeJsonAtomic } from '../util/atomic-write'
import { manifestPath } from '../folder-state/store'

/** Machine-level recent-folders index (paths only; state lives per folder). */
interface RecentsFile {
  version: 1
  folders: Array<{ path: string; lastUsedAt: number }>
}

const MAX_RECENTS = 8

function recentsPath(): string {
  return join(app.getPath('userData'), 'recents.json')
}

export async function touchRecent(rootPath: string): Promise<void> {
  const file = (await readJson<RecentsFile>(recentsPath())) ?? { version: 1, folders: [] }
  const rest = file.folders.filter((f) => f.path !== rootPath)
  rest.unshift({ path: rootPath, lastUsedAt: Date.now() })
  file.folders = rest.slice(0, MAX_RECENTS)
  await writeJsonAtomic(recentsPath(), file)
}

export async function listRecents(): Promise<RecentFolder[]> {
  const file = await readJson<RecentsFile>(recentsPath())
  if (!file) return []
  const out: RecentFolder[] = []
  for (const entry of file.folders) {
    try {
      const stat = await fs.stat(entry.path)
      if (!stat.isDirectory()) continue
    } catch {
      continue // folder vanished — drop silently from the listing
    }
    let hasManifest = false
    try {
      await fs.access(manifestPath(entry.path))
      hasManifest = true
    } catch {
      /* never organized */
    }
    out.push({
      path: entry.path,
      name: basename(entry.path),
      lastUsedAt: entry.lastUsedAt,
      hasManifest
    })
  }
  return out
}
