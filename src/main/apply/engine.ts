import { promises as fs } from 'fs'
import { dirname, join, sep } from 'path'
import { randomUUID } from 'crypto'
import type { ApplyResult, CollisionNote, SkippedFile } from '@shared/types'
import type { StrategyConfig } from '@shared/strategies'
import {
  ensureStateDirWritable,
  readJournal,
  readManifest,
  trashDir,
  writeJournal,
  writeManifest
} from '../folder-state/store'
import type { JournalFile, JournalOperation, ManifestFile } from '../folder-state/types'
import { OrdinoFailure } from '../util/failure'

export interface ApplyInput {
  strategy: StrategyConfig
  /** Root-relative POSIX paths, pre-validated by the caller. */
  moves: Array<{ source: string; destination: string }>
  trash: Array<{ source: string }>
  /**
   * Files the plan reviewed and deliberately left where they are — recorded
   * in the manifest so re-runs are idempotent (Goal 7): without this, an
   * unmoved file would be re-sent to the AI on every run. User-excluded
   * moves are NOT in this list — those get re-proposed next time.
   */
  recordInPlace?: Array<{ path: string; size: number; mtimeMs: number }>
}

export interface ApplyEngineOptions {
  /** OS-trash a file (shell.trashItem in production; injectable for tests). */
  osTrash: (absPath: string) => Promise<void>
  onProgress?: (p: {
    operationId: string
    done: number
    total: number
    currentRelPath: string
    stage: 'moving' | 'trashing'
  }) => void
}

const JOURNAL_WRITE_EVERY = 20

const toAbs = (root: string, rel: string): string => join(root, ...rel.split('/'))

function mapFsError(e: unknown): { reasonCode: SkippedFile['reasonCode']; detail: string } {
  const code = (e as NodeJS.ErrnoException)?.code
  const detail = e instanceof Error ? e.message : String(e)
  if (code === 'EACCES' || code === 'EPERM') return { reasonCode: 'permission', detail }
  if (code === 'EBUSY' || code === 'ETXTBSY') return { reasonCode: 'locked', detail }
  if (code === 'ENOENT') return { reasonCode: 'missing', detail }
  return { reasonCode: 'unknown', detail }
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

/** rename with cross-device fallback (copy → fsync → verify size → unlink). */
async function moveFile(absFrom: string, absTo: string): Promise<void> {
  try {
    await fs.rename(absFrom, absTo)
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EXDEV') throw e
    await fs.copyFile(absFrom, absTo)
    const [a, b] = await Promise.all([fs.lstat(absFrom), fs.lstat(absTo)])
    if (a.size !== b.size) {
      await fs.rm(absTo, { force: true })
      throw new Error(`Copy verification failed for ${absFrom}`)
    }
    await fs.unlink(absFrom)
  }
}

/**
 * Closing the undo window: staged trash from a superseded operation finally
 * goes to the OS trash and the op is marked finalized ("never hard-deleted",
 * P0-8 — just deferred while undo was possible).
 */
export async function finalizeSupersededOps(
  root: string,
  journal: JournalFile,
  osTrash: ApplyEngineOptions['osTrash']
): Promise<boolean> {
  let changed = false
  for (const op of journal.operations) {
    if (op.status !== 'applied' && op.status !== 'partial') continue
    for (const trash of op.trashes) {
      if (trash.status !== 'staged' || !trash.stagedAt) continue
      const abs = join(root, ...trash.stagedAt.split('/'))
      try {
        await osTrash(abs)
        trash.status = 'os-trashed'
      } catch (e) {
        trash.detail = e instanceof Error ? e.message : String(e)
      }
      changed = true
    }
    op.status = 'finalized'
    changed = true
    // Best-effort cleanup of the op's now-empty staging dir.
    try {
      await fs.rm(trashDir(root, op.id), { recursive: true, force: true })
    } catch {
      /* staging dir cleanup is cosmetic */
    }
  }
  return changed
}

export async function applyToFolder(
  root: string,
  input: ApplyInput,
  options: ApplyEngineOptions
): Promise<ApplyResult> {
  await ensureStateDirWritable(root)

  const { journal } = await readJournal(root)
  const hasActive = journal.operations.some((op) => op.status === 'pending')
  if (hasActive) {
    throw new OrdinoFailure('APPLY_IN_PROGRESS', 'A previous apply did not finish — undo it first')
  }

  // Single-level undo: a new apply supersedes the previous one (§5.6).
  await finalizeSupersededOps(root, journal, options.osTrash)

  const operationId = randomUUID()
  const op: JournalOperation = {
    id: operationId,
    startedAt: Date.now(),
    strategy: input.strategy,
    status: 'pending',
    createdFolders: [],
    moves: input.moves.map((m) => ({
      source: m.source,
      requestedDestination: m.destination,
      status: 'pending'
    })),
    trashes: input.trash.map((t) => ({ source: t.source, status: 'pending' }))
  }
  journal.operations.push(op)
  // Journal hits disk BEFORE the first move (P0-6).
  await writeJournal(root, journal)

  const total = op.moves.length + op.trashes.length
  let done = 0
  let sinceWrite = 0
  const flushIfDue = async (force = false): Promise<void> => {
    sinceWrite += 1
    if (force || sinceWrite >= JOURNAL_WRITE_EVERY) {
      sinceWrite = 0
      await writeJournal(root, journal)
    }
  }

  const skipped: SkippedFile[] = []
  const failed: SkippedFile[] = []
  const collisions: CollisionNote[] = []
  const createdSet = new Set<string>()

  // Destination folders first, recording which ones Ordino actually created.
  for (const move of op.moves) {
    const destDirRel = move.requestedDestination.includes('/')
      ? move.requestedDestination.slice(0, move.requestedDestination.lastIndexOf('/'))
      : ''
    if (destDirRel === '') continue
    const segments = destDirRel.split('/')
    for (let i = 1; i <= segments.length; i++) {
      const partial = segments.slice(0, i).join('/')
      if (createdSet.has(partial)) continue
      const abs = toAbs(root, partial)
      if (!(await exists(abs))) {
        try {
          await fs.mkdir(abs)
          createdSet.add(partial)
          op.createdFolders.push(partial)
        } catch {
          // Move below will fail with the real error.
        }
      }
    }
  }

  const { resolveCollision } = await import('./collisions')

  for (const move of op.moves) {
    done += 1
    options.onProgress?.({
      operationId,
      done,
      total,
      currentRelPath: move.source,
      stage: 'moving'
    })

    const absSource = toAbs(root, move.source)
    if (!(await exists(absSource))) {
      move.status = 'skipped'
      move.reasonCode = 'missing'
      skipped.push({ path: move.source, reasonCode: 'missing' })
      await flushIfDue()
      continue
    }

    try {
      const requestedAbs = toAbs(root, move.requestedDestination)
      const { finalAbs, collided } = await resolveCollision(requestedAbs)
      await moveFile(absSource, finalAbs)
      const finalRel = finalAbs
        .slice(root.length + 1)
        .split(sep)
        .join('/')
      move.finalDestination = finalRel
      move.status = 'moved'
      const stat = await fs.lstat(finalAbs)
      move.postMoveSize = stat.size
      move.postMoveMtimeMs = Math.round(stat.mtimeMs)
      if (collided) {
        collisions.push({
          from: move.source,
          requested: move.requestedDestination,
          finalDestination: finalRel
        })
      }
    } catch (e) {
      const { reasonCode, detail } = mapFsError(e)
      move.status = 'skipped'
      move.reasonCode = reasonCode
      move.detail = detail
      skipped.push({ path: move.source, reasonCode, detail })
    }
    await flushIfDue()
  }

  // Duplicates marked for trash: staged inside the root (same volume, atomic,
  // restorable) — OS trash happens when the undo window closes.
  if (op.trashes.length > 0) {
    try {
      await fs.mkdir(trashDir(root, operationId), { recursive: true })
    } catch {
      // Per-file staging below falls back to direct OS trash.
    }
  }
  for (const trash of op.trashes) {
    done += 1
    options.onProgress?.({
      operationId,
      done,
      total,
      currentRelPath: trash.source,
      stage: 'trashing'
    })
    const absSource = toAbs(root, trash.source)
    const stagedRel = `${'.ordino'}/trash/${operationId}/${trash.source}`
    const absStaged = join(root, ...stagedRel.split('/'))
    try {
      await fs.mkdir(dirname(absStaged), { recursive: true })
      await moveFile(absSource, absStaged)
      trash.stagedAt = stagedRel
      trash.status = 'staged'
    } catch {
      // Staging failed — fall back to direct OS trash (non-restorable, but
      // the file still never gets hard-deleted).
      try {
        await options.osTrash(absSource)
        trash.status = 'os-trashed'
      } catch (e2) {
        const { reasonCode, detail } = mapFsError(e2)
        trash.status = 'failed'
        trash.detail = detail
        failed.push({ path: trash.source, reasonCode, detail })
      }
    }
    await flushIfDue()
  }

  op.status = failed.length > 0 || skipped.length > 0 ? 'partial' : 'applied'
  op.finishedAt = Date.now()
  await writeJournal(root, journal)

  await updateManifestAfterApply(root, input.strategy, op, input.recordInPlace ?? [])

  return {
    operationId,
    moved: op.moves.filter((m) => m.status === 'moved').length,
    trashed: op.trashes.filter((t) => t.status === 'staged' || t.status === 'os-trashed').length,
    skipped,
    failed,
    collisions
  }
}

async function updateManifestAfterApply(
  root: string,
  strategy: StrategyConfig,
  op: JournalOperation,
  recordInPlace: Array<{ path: string; size: number; mtimeMs: number }>
): Promise<void> {
  const existing = await readManifest(root)
  const manifest: ManifestFile = existing ?? {
    version: 1,
    strategy,
    updatedAt: 0,
    managedFolders: [],
    files: {}
  }
  manifest.strategy = strategy
  manifest.updatedAt = Date.now()

  const managed = new Set(manifest.managedFolders)
  for (const folder of op.createdFolders) managed.add(folder)
  manifest.managedFolders = [...managed].sort()

  for (const move of op.moves) {
    if (move.status !== 'moved' || !move.finalDestination) continue
    delete manifest.files[move.source]
    manifest.files[move.finalDestination] = {
      size: move.postMoveSize ?? 0,
      mtimeMs: move.postMoveMtimeMs ?? 0,
      organizedAt: Date.now()
    }
  }
  for (const entry of recordInPlace) {
    manifest.files[entry.path] = {
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      organizedAt: Date.now()
    }
  }
  for (const trash of op.trashes) {
    delete manifest.files[trash.source]
  }

  await writeManifest(root, manifest)
}
