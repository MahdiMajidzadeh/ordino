import { z } from 'zod'
import { basename } from 'path'
import type { HistoryDetail, HistoryEntry } from '@shared/types'
import { handle } from '../typed-ipc'
import { OrdinoFailure } from '../../util/failure'
import { listRecents } from '../../settings/recents'
import { readJournal } from '../../folder-state/store'
import type { JournalOperation } from '../../folder-state/types'

function entryOf(rootPath: string, op: JournalOperation, undoable: boolean): HistoryEntry {
  return {
    id: op.id,
    rootPath,
    rootName: basename(rootPath),
    appliedAt: op.finishedAt ?? op.startedAt,
    strategy: op.strategy,
    moved: op.moves.filter((m) => m.status === 'moved' || m.status === 'restored').length,
    trashed: op.trashes.filter((t) => t.status !== 'pending' && t.status !== 'failed').length,
    skipped: op.moves.filter((m) => m.status === 'skipped').length,
    failed: op.trashes.filter((t) => t.status === 'failed').length,
    status: op.status,
    undoable
  }
}

function lastUndoableId(ops: JournalOperation[]): string | null {
  for (let i = ops.length - 1; i >= 0; i--) {
    const op = ops[i]
    if (op.status === 'applied' || op.status === 'partial' || op.status === 'pending') return op.id
    if (op.status === 'undone' || op.status === 'finalized') return null
  }
  return null
}

/**
 * P1-2: read-only log aggregated from the journals of recently-used folders
 * (per-folder change logs live inside each folder; the app only remembers
 * which folders it has seen).
 */
export function registerHistoryHandlers(): void {
  handle('history:list', null, async () => {
    const recents = await listRecents()
    const entries: HistoryEntry[] = []
    for (const recent of recents) {
      const { journal } = await readJournal(recent.path)
      const undoableId = lastUndoableId(journal.operations)
      for (const op of journal.operations) {
        entries.push(entryOf(recent.path, op, op.id === undoableId))
      }
    }
    return entries.sort((a, b) => b.appliedAt - a.appliedAt)
  })

  handle(
    'history:get',
    z.object({ rootPath: z.string().min(1), operationId: z.string().min(1) }),
    async ({ rootPath, operationId }): Promise<HistoryDetail> => {
      const { journal } = await readJournal(rootPath)
      const op = journal.operations.find((o) => o.id === operationId)
      if (!op) throw new OrdinoFailure('INVALID_REQUEST', 'Unknown operation')
      return {
        ...entryOf(rootPath, op, lastUndoableId(journal.operations) === op.id),
        ops: [
          ...op.moves.map((m) => ({
            kind: 'move' as const,
            from: m.source,
            to: m.finalDestination ?? m.requestedDestination,
            status: m.status
          })),
          ...op.trashes.map((t) => ({ kind: 'trash' as const, from: t.source, status: t.status }))
        ]
      }
    }
  )
}
