import { promises as fs } from 'fs'
import { dirname, join } from 'path'
import type { SkippedFile, UndoAvailability, UndoResult } from '@shared/types'
import { readJournal, readManifest, trashDir, writeJournal, writeManifest } from '../folder-state/store'
import type { JournalOperation } from '../folder-state/types'
import { OrdinoFailure } from '../util/failure'

const toAbs = (root: string, rel: string): string => join(root, ...rel.split('/'))

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}

function undoableOp(operations: JournalOperation[]): JournalOperation | undefined {
  for (let i = operations.length - 1; i >= 0; i--) {
    const op = operations[i]
    if (op.status === 'applied' || op.status === 'partial' || op.status === 'pending') return op
    if (op.status === 'undone' || op.status === 'finalized') return undefined
  }
  return undefined
}

export async function undoAvailability(root: string): Promise<UndoAvailability> {
  const { journal } = await readJournal(root)
  const op = undoableOp(journal.operations)
  if (!op) return { available: false }
  return {
    available: true,
    operationId: op.id,
    appliedAt: op.finishedAt ?? op.startedAt,
    moveCount: op.moves.filter((m) => m.status === 'moved').length,
    trashCount: op.trashes.filter((t) => t.status === 'staged').length,
    recovery: op.status === 'pending'
  }
}

export interface UndoOptions {
  onProgress?: (p: {
    operationId: string
    done: number
    total: number
    currentRelPath: string
    stage: 'restoring'
  }) => void
}

/**
 * Reverse the last apply (P0-7): moved files return to their original paths
 * (reverse order), staged trash is restored, Ordino-created folders that are
 * now empty are removed deepest-first. Files the user changed or displaced
 * after apply are skipped with reasons. Also handles crash recovery: a
 * 'pending' op (apply died mid-flight) undoes the entries it completed.
 */
export async function undoLastOperation(root: string, options: UndoOptions = {}): Promise<UndoResult> {
  const { journal } = await readJournal(root)
  const op = undoableOp(journal.operations)
  if (!op) {
    throw new OrdinoFailure('UNDO_NOT_AVAILABLE', 'Nothing to undo for this folder')
  }

  const notRestored: SkippedFile[] = []
  let restored = 0
  let restoredFromTrash = 0
  const movedEntries = op.moves.filter((m) => m.status === 'moved')
  const stagedEntries = op.trashes.filter((t) => t.status === 'staged')
  const total = movedEntries.length + stagedEntries.length
  let done = 0

  for (let i = op.moves.length - 1; i >= 0; i--) {
    const move = op.moves[i]
    if (move.status !== 'moved' || !move.finalDestination) continue
    done += 1
    options.onProgress?.({
      operationId: op.id,
      done,
      total,
      currentRelPath: move.source,
      stage: 'restoring'
    })

    const absAt = toAbs(root, move.finalDestination)
    const absHome = toAbs(root, move.source)
    if (!(await exists(absAt))) {
      notRestored.push({ path: move.finalDestination, reasonCode: 'missing' })
      continue
    }
    try {
      const stat = await fs.lstat(absAt)
      const sameSize = move.postMoveSize === undefined || stat.size === move.postMoveSize
      const sameMtime =
        move.postMoveMtimeMs === undefined || Math.abs(stat.mtimeMs - move.postMoveMtimeMs) < 2
      if (!sameSize || !sameMtime) {
        notRestored.push({ path: move.finalDestination, reasonCode: 'modified' })
        continue
      }
      if (await exists(absHome)) {
        notRestored.push({ path: move.source, reasonCode: 'occupied' })
        continue
      }
      await fs.mkdir(dirname(absHome), { recursive: true })
      await fs.rename(absAt, absHome)
      move.status = 'restored'
      restored += 1
    } catch (e) {
      notRestored.push({
        path: move.finalDestination,
        reasonCode: 'unknown',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  for (const trash of op.trashes) {
    if (trash.status === 'os-trashed') {
      notRestored.push({
        path: trash.source,
        reasonCode: 'missing',
        detail: 'Already in the system Trash'
      })
      continue
    }
    if (trash.status !== 'staged' || !trash.stagedAt) continue
    done += 1
    options.onProgress?.({
      operationId: op.id,
      done,
      total,
      currentRelPath: trash.source,
      stage: 'restoring'
    })
    const absStaged = toAbs(root, trash.stagedAt)
    const absHome = toAbs(root, trash.source)
    try {
      if (await exists(absHome)) {
        notRestored.push({ path: trash.source, reasonCode: 'occupied' })
        continue
      }
      if (!(await exists(absStaged))) {
        notRestored.push({ path: trash.source, reasonCode: 'missing' })
        continue
      }
      await fs.mkdir(dirname(absHome), { recursive: true })
      await fs.rename(absStaged, absHome)
      trash.status = 'restored'
      restored += 1
      restoredFromTrash += 1
    } catch (e) {
      notRestored.push({
        path: trash.source,
        reasonCode: 'unknown',
        detail: e instanceof Error ? e.message : String(e)
      })
    }
  }

  // Ordino-created folders, deepest first, only when now empty.
  let removedFolders = 0
  const byDepth = [...op.createdFolders].sort(
    (a, b) => b.split('/').length - a.split('/').length || b.localeCompare(a)
  )
  for (const folder of byDepth) {
    try {
      await fs.rmdir(toAbs(root, folder))
      removedFolders += 1
    } catch {
      // Not empty or already gone — leave it.
    }
  }
  try {
    await fs.rm(trashDir(root, op.id), { recursive: true, force: true })
  } catch {
    /* cosmetic */
  }

  op.status = 'undone'
  op.finishedAt = Date.now()
  await writeJournal(root, journal)

  await updateManifestAfterUndo(root, op)

  return { operationId: op.id, restored, restoredFromTrash, removedFolders, notRestored }
}

async function updateManifestAfterUndo(root: string, op: JournalOperation): Promise<void> {
  const manifest = await readManifest(root)
  if (!manifest) return
  for (const move of op.moves) {
    if (move.status === 'restored' && move.finalDestination) {
      delete manifest.files[move.finalDestination]
    }
  }
  const created = new Set(op.createdFolders)
  manifest.managedFolders = manifest.managedFolders.filter((f) => !created.has(f))
  manifest.updatedAt = Date.now()
  await writeManifest(root, manifest)
}
