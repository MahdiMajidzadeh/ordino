import { promises as fs, type Dirent } from 'fs'
import { basename, join } from 'path'
import { randomUUID } from 'crypto'
import type { ScanDir, ScanFile, ScanResult, ScanWarning } from '@shared/types'
import { mapPool } from '../util/pool'
import { isHiddenOrSystemEntry } from './filters'
import { compileIgnoreGlobs, type IgnoreMatcher } from './globs'

export interface ScanOptions {
  ignoreGlobs: readonly string[]
  signal?: AbortSignal
  onProgress?: (entriesSeen: number) => void
}

interface PendingFile {
  relPath: string
  name: string
  parentDir: string
  isSymlink: boolean
}

/**
 * Full recursive scan (P0-1). Everything readable is scanned locally — the
 * subfolder Include/Skip choice gates what reaches the AI and the plan, not
 * what this walker sees (counts are needed for the inclusion UI). Symlinks
 * are surfaced as file entries and never followed (Open Q4). The re-run diff
 * (`rerun`) is attached by the caller once the manifest store exists.
 */
export async function scanFolder(rootPath: string, options: ScanOptions): Promise<ScanResult> {
  const ignore: IgnoreMatcher = compileIgnoreGlobs(options.ignoreGlobs)
  const warnings: ScanWarning[] = []
  const dirs: ScanDir[] = []
  const pendingFiles: PendingFile[] = []
  let ignoredCount = 0
  let entriesSeen = 0

  async function walk(relDir: string, depth: number): Promise<void> {
    if (options.signal?.aborted) throw new DOMException('Aborted', 'AbortError')
    const absDir = relDir === '' ? rootPath : join(rootPath, relDir)
    let entries: Dirent[]
    try {
      entries = await fs.readdir(absDir, { withFileTypes: true })
    } catch (e) {
      warnings.push({
        relPath: relDir,
        reasonCode: 'unreadable',
        detail: e instanceof Error ? e.message : undefined
      })
      return
    }

    const subdirs: string[] = []
    for (const entry of entries) {
      entriesSeen += 1
      if (entriesSeen % 200 === 0) options.onProgress?.(entriesSeen)

      const name = entry.name
      if (isHiddenOrSystemEntry(name)) {
        ignoredCount += 1
        continue
      }
      const relPath = relDir === '' ? name : `${relDir}/${name}`
      if (ignore(relPath, name)) {
        ignoredCount += 1
        continue
      }

      if (entry.isSymbolicLink()) {
        // Never followed — recorded as a file row whether it points at a
        // file, a dir, or nothing (Open Q4: the link itself gets moved).
        pendingFiles.push({ relPath, name, parentDir: relDir, isSymlink: true })
      } else if (entry.isDirectory()) {
        subdirs.push(relPath)
      } else if (entry.isFile()) {
        pendingFiles.push({ relPath, name, parentDir: relDir, isSymlink: false })
      }
      // Sockets, FIFOs, devices: silently out of scope.
    }

    for (const sub of subdirs) {
      dirs.push({
        relPath: sub,
        name: basename(sub),
        parentDir: relDir,
        fileCount: 0,
        totalFileCount: 0,
        depth,
        managedByOrdino: false
      })
      await walk(sub, depth + 1)
    }
  }

  await walk('', 0)

  // Stat files through a bounded pool — the dominant cost on large folders.
  const files: ScanFile[] = []
  const statted = await mapPool(
    pendingFiles,
    32,
    async (pf): Promise<ScanFile | null> => {
      try {
        const s = await fs.lstat(join(rootPath, pf.relPath))
        const dotIdx = pf.name.lastIndexOf('.')
        return {
          id: pf.relPath,
          relPath: pf.relPath,
          name: pf.name,
          ext: dotIdx > 0 ? pf.name.slice(dotIdx + 1).toLowerCase() : '',
          size: s.size,
          createdAt: Math.round(s.birthtimeMs || s.ctimeMs),
          modifiedAt: Math.round(s.mtimeMs),
          parentDir: pf.parentDir,
          isSymlink: pf.isSymlink
        }
      } catch (e) {
        warnings.push({
          relPath: pf.relPath,
          reasonCode: 'stat-failed',
          detail: e instanceof Error ? e.message : undefined
        })
        return null
      }
    },
    options.signal
  )
  for (const f of statted) if (f) files.push(f)

  // Per-dir counts: direct, then roll totals up ancestor chains.
  const directCount = new Map<string, number>()
  for (const f of files) {
    directCount.set(f.parentDir, (directCount.get(f.parentDir) ?? 0) + 1)
  }
  const totalCount = new Map<string, number>()
  for (const f of files) {
    let dir = f.parentDir
    while (dir !== '') {
      totalCount.set(dir, (totalCount.get(dir) ?? 0) + 1)
      const slash = dir.lastIndexOf('/')
      dir = slash === -1 ? '' : dir.slice(0, slash)
    }
  }
  for (const d of dirs) {
    d.fileCount = directCount.get(d.relPath) ?? 0
    d.totalFileCount = totalCount.get(d.relPath) ?? 0
  }

  options.onProgress?.(entriesSeen)

  return {
    scanId: randomUUID(),
    rootPath,
    rootName: basename(rootPath),
    files,
    dirs,
    totalSize: files.reduce((acc, f) => acc + f.size, 0),
    ignoredCount,
    warnings,
    rerun: null
  }
}
