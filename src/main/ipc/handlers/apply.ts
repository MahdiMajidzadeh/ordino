import { shell } from 'electron'
import { z } from 'zod'
import { handle, emit } from '../typed-ipc'
import { OrdinoFailure } from '../../util/failure'
import { getPlan } from '../../plan-registry'
import { getScan } from '../../scan-registry'
import { validatePlan } from '../../plan/validate'
import { applyToFolder } from '../../apply/engine'
import { undoAvailability, undoLastOperation } from '../../apply/undo'

const strategySchema = z.object({
  id: z.enum(['smart', 'fileType', 'date', 'custom']),
  dateGranularity: z.enum(['year', 'year-month']).optional(),
  customInstruction: z.string().max(4000).optional(),
  reuseExistingFolders: z.boolean()
})

const applySchema = z.object({
  rootPath: z.string().min(1),
  planId: z.string().min(1),
  strategy: strategySchema,
  moves: z.array(
    z.object({ fileId: z.string(), source: z.string().min(1), destination: z.string().min(1) })
  ),
  trash: z.array(z.object({ fileId: z.string(), path: z.string().min(1) })),
  newFolders: z.array(z.string())
})

export function registerApplyHandlers(): void {
  handle('apply:start', applySchema, async (req) => {
    // The renderer edited this plan (exclusions, reassignments) — re-validate
    // everything against main's own copy of the scan; never trust the wire.
    const plan = getPlan(req.planId)
    if (!plan || plan.rootPath !== req.rootPath) {
      throw new OrdinoFailure('INVALID_REQUEST', 'Plan expired — analyze the folder again', {
        retryable: true
      })
    }
    const scan = getScan(plan.scanId)
    if (!scan) {
      throw new OrdinoFailure('SCAN_FAILED', 'Scan expired — pick the folder again', {
        retryable: true
      })
    }

    const validated = validatePlan(
      {
        newFolders: req.newFolders,
        moves: req.moves.map((m) => ({ source: m.source, destination: m.destination, reason: '' }))
      },
      {
        validSources: new Set(scan.files.map((f) => f.relPath)),
        existingFolders: new Set(scan.dirs.map((d) => d.relPath))
      }
    )
    if (validated.moves.length !== req.moves.length) {
      // Something the renderer sent didn't survive validation — refuse rather
      // than silently applying a subset (P0-4 spirit).
      throw new OrdinoFailure('INVALID_REQUEST', 'The edited plan contains invalid moves', {
        detail: validated.warnings.map((w) => w.detail).join('; ')
      })
    }

    // Only flagged duplicates may be trashed, ever (P0-8) — and a file being
    // trashed can never also be moved.
    const duplicateIds = new Set(plan.duplicateGroups.flatMap((g) => g.fileIds))
    for (const trash of req.trash) {
      if (!duplicateIds.has(trash.fileId) || trash.path !== trash.fileId) {
        throw new OrdinoFailure('INVALID_REQUEST', 'Only detected duplicates can be trashed')
      }
    }
    const trashedSources = new Set(req.trash.map((t) => t.path))
    if (validated.moves.some((m) => trashedSources.has(m.source))) {
      throw new OrdinoFailure('INVALID_REQUEST', 'A file cannot be both moved and trashed')
    }

    // Files the AI reviewed and left in place become manifest entries so the
    // next run doesn't re-analyze them (Goal 7). Trashed files never count.
    const trashedIds = new Set(req.trash.map((t) => t.fileId))
    const fileById = new Map(scan.files.map((f) => [f.id, f]))
    const recordInPlace = plan.unchangedFileIds
      .filter((id) => !trashedIds.has(id))
      .map((id) => fileById.get(id))
      .filter((f): f is NonNullable<typeof f> => f !== undefined)
      .map((f) => ({ path: f.relPath, size: f.size, mtimeMs: f.modifiedAt }))

    return applyToFolder(
      req.rootPath,
      {
        strategy: req.strategy,
        moves: validated.moves.map((m) => ({ source: m.source, destination: m.destination })),
        trash: req.trash.map((t) => ({ source: t.path })),
        recordInPlace
      },
      {
        osTrash: (absPath) => shell.trashItem(absPath),
        onProgress: (p) => emit('apply:progress', p)
      }
    )
  })

  handle('undo:status', z.object({ rootPath: z.string().min(1) }), async ({ rootPath }) =>
    undoAvailability(rootPath)
  )

  handle('undo:last', z.object({ rootPath: z.string().min(1) }), async ({ rootPath }) =>
    undoLastOperation(rootPath, { onProgress: (p) => emit('apply:progress', p) })
  )
}
