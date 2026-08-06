import type { RerunDiff, ScanResult } from '@shared/types'
import { readManifest, writeManifest } from '../folder-state/store'
import type { ManifestFile } from '../folder-state/types'

export interface DiffOutcome {
  rerun: RerunDiff
  /** Manifest after pruning entries/folders that vanished from disk. */
  pruned: ManifestFile
  prunedAnything: boolean
}

/**
 * Re-run diff (§5.7): files still at their organized destination stay out of
 * the plan — even when modified in place. Files the manifest doesn't know are
 * the organize set. Entries that vanished from disk are pruned; managed
 * folders the user renamed/deleted drop out of management and naturally
 * reappear as user-owned existing destinations via the scan (Open Q7).
 */
export function diffScanAgainstManifest(scan: ScanResult, manifest: ManifestFile): DiffOutcome {
  const onDisk = new Set(scan.files.map((f) => f.relPath))
  const dirsOnDisk = new Set(scan.dirs.map((d) => d.relPath))

  const organizedFileIds: string[] = []
  const prunedFiles: ManifestFile['files'] = {}
  let prunedAnything = false

  for (const [relPath, entry] of Object.entries(manifest.files)) {
    if (onDisk.has(relPath)) {
      organizedFileIds.push(relPath)
      prunedFiles[relPath] = entry
    } else {
      prunedAnything = true
    }
  }

  const managedFolders = manifest.managedFolders.filter((f) => {
    if (dirsOnDisk.has(f)) return true
    prunedAnything = true
    return false
  })

  const organizedSet = new Set(organizedFileIds)
  const newFileIds = scan.files.filter((f) => !organizedSet.has(f.id)).map((f) => f.id)

  const pruned: ManifestFile = {
    ...manifest,
    files: prunedFiles,
    managedFolders
  }

  return {
    rerun: {
      manifestStrategy: manifest.strategy,
      organizedFileIds,
      managedFolders,
      newFileIds,
      nothingToDo: newFileIds.length === 0,
      lastAppliedAt: manifest.updatedAt
    },
    pruned,
    prunedAnything
  }
}

/**
 * Attach re-run info to a completed scan: computes the diff, persists any
 * pruning, and marks Ordino-managed dirs for the UI. No-op for folders
 * Ordino has never organized.
 */
export async function attachRerunDiff(scan: ScanResult): Promise<ScanResult> {
  const manifest = await readManifest(scan.rootPath)
  if (!manifest || Object.keys(manifest.files).length === 0) return scan

  const { rerun, pruned, prunedAnything } = diffScanAgainstManifest(scan, manifest)
  if (prunedAnything) {
    pruned.updatedAt = Date.now()
    await writeManifest(scan.rootPath, pruned)
  }

  const managed = new Set(rerun.managedFolders)
  for (const dir of scan.dirs) {
    if (managed.has(dir.relPath)) dir.managedByOrdino = true
  }
  return { ...scan, rerun }
}
