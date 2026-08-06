import { createHash } from 'crypto'
import { createReadStream } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import type { DuplicateGroup, ScanFile } from '@shared/types'
import { mapPool } from '../util/pool'
import { pickKeeper } from './keeper'

export interface DuplicateProgressUpdate {
  candidates: number
  hashed: number
  totalBytes: number
  hashedBytes: number
  done: boolean
}

export interface DetectOptions {
  signal?: AbortSignal
  onProgress?: (update: DuplicateProgressUpdate) => void
  /** Manifest-organized file ids, for the keeper heuristic. */
  organizedIds?: ReadonlySet<string>
}

async function sha256OfFile(absPath: string, signal?: AbortSignal): Promise<string> {
  const hash = createHash('sha256')
  await pipeline(createReadStream(absPath), hash, { signal })
  return hash.digest('hex')
}

/**
 * Local duplicate detection (P0-8): group by size, then SHA-256 only the
 * size-matched candidates. Fully local — hashes never leave the machine.
 * Runs concurrently with the AI call under the analysis job's signal.
 */
export async function detectDuplicates(
  rootPath: string,
  files: readonly ScanFile[],
  options: DetectOptions = {}
): Promise<DuplicateGroup[]> {
  const bySize = new Map<number, ScanFile[]>()
  for (const file of files) {
    if (file.size === 0 || file.isSymlink) continue
    const bucket = bySize.get(file.size)
    if (bucket) bucket.push(file)
    else bySize.set(file.size, [file])
  }

  const candidates: ScanFile[] = []
  for (const bucket of bySize.values()) {
    if (bucket.length > 1) candidates.push(...bucket)
  }

  const totalBytes = candidates.reduce((acc, f) => acc + f.size, 0)
  let hashed = 0
  let hashedBytes = 0
  const report = (done: boolean): void =>
    options.onProgress?.({ candidates: candidates.length, hashed, hashedBytes, totalBytes, done })

  report(candidates.length === 0)
  if (candidates.length === 0) return []

  // Disk-bound: 4 concurrent streams is the sweet spot (HDDs degrade beyond).
  const digests = await mapPool(
    candidates,
    4,
    async (file): Promise<string | null> => {
      try {
        const digest = await sha256OfFile(join(rootPath, file.relPath), options.signal)
        hashed += 1
        hashedBytes += file.size
        report(false)
        return digest
      } catch (e) {
        if (options.signal?.aborted) throw e
        hashed += 1
        report(false) // unreadable candidate — not a duplicate, not fatal
        return null
      }
    },
    options.signal
  )

  const byDigest = new Map<string, ScanFile[]>()
  candidates.forEach((file, i) => {
    const digest = digests[i]
    if (!digest) return
    const key = `${file.size}:${digest}`
    const bucket = byDigest.get(key)
    if (bucket) bucket.push(file)
    else byDigest.set(key, [file])
  })

  const groups: DuplicateGroup[] = []
  let n = 0
  for (const [key, members] of byDigest) {
    if (members.length < 2) continue
    const { keeperId, reasonCode } = pickKeeper(members, options.organizedIds ?? new Set())
    groups.push({
      id: `dup-${n++}-${key.slice(0, 16)}`,
      size: members[0].size,
      fileIds: members.map((f) => f.id),
      recommendedKeeperId: keeperId,
      keeperReasonCode: reasonCode
    })
  }

  report(true)
  return groups
}
