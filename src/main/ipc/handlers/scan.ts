import { promises as fs } from 'fs'
import { basename, join } from 'path'
import { z } from 'zod'
import type { QuickScanSummary } from '@shared/types'
import { handle } from '../typed-ipc'
import { OrdinoFailure } from '../../util/failure'
import { isHiddenOrSystemEntry } from '../../scanner/filters'
import { scanFolder } from '../../scanner/scan'
import { rememberScan } from '../../scan-registry'
import { attachRerunDiff } from '../../manifest/differ'
import { getSettings } from '../../settings/store'
import { readFolderSettings } from '../../folder-state/store'
import { touchRecent } from '../../settings/recents'

/** Global ignore globs, overridden per folder when the folder says so (P1-6). */
async function effectiveIgnoreGlobs(rootPath: string): Promise<string[]> {
  const settings = await getSettings()
  const folder = await readFolderSettings(rootPath)
  return folder?.ignoreGlobs ?? settings.ignoreGlobs
}

async function assertReadableDirectory(rootPath: string): Promise<void> {
  let stat
  try {
    stat = await fs.stat(rootPath)
  } catch {
    throw new OrdinoFailure('SCAN_NOT_FOUND', `Folder not found: ${rootPath}`)
  }
  if (!stat.isDirectory()) {
    throw new OrdinoFailure('FOLDER_NOT_DIRECTORY', `Not a folder: ${rootPath}`)
  }
}

export function registerScanHandlers(): void {
  handle('scan:folder', z.object({ rootPath: z.string().min(1) }), async ({ rootPath }) => {
    await assertReadableDirectory(rootPath)
    const globs = await effectiveIgnoreGlobs(rootPath)
    const scanned = await scanFolder(rootPath, { ignoreGlobs: globs })
    const result = await attachRerunDiff(scanned)
    rememberScan(result)
    await touchRecent(rootPath)
    return result
  })

  handle('scan:quick', z.object({ rootPath: z.string().min(1) }), async ({ rootPath }) => {
    await assertReadableDirectory(rootPath)

    let entries
    try {
      entries = await fs.readdir(rootPath, { withFileTypes: true })
    } catch (e) {
      throw new OrdinoFailure('FOLDER_NOT_READABLE', `Cannot read folder: ${rootPath}`, {
        detail: e instanceof Error ? e.message : undefined
      })
    }

    const summary: QuickScanSummary = {
      rootPath,
      rootName: basename(rootPath),
      fileCount: 0,
      dirCount: 0,
      totalSize: 0
    }

    for (const entry of entries) {
      if (isHiddenOrSystemEntry(entry.name)) continue
      if (entry.isDirectory()) {
        summary.dirCount += 1
      } else if (entry.isFile() || entry.isSymbolicLink()) {
        summary.fileCount += 1
        try {
          const s = await fs.lstat(join(rootPath, entry.name))
          summary.totalSize += s.size
        } catch {
          // Unreadable entry — counted, size unknown.
        }
      }
    }

    return summary
  })
}
