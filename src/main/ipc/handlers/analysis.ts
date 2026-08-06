import { randomUUID } from 'crypto'
import { z } from 'zod'
import type { AnalysisResult, Plan, ScanFile } from '@shared/types'
import { fileIsIncluded } from '@shared/inclusion'
import { handle, emit } from '../typed-ipc'
import { OrdinoFailure } from '../../util/failure'
import { getScan } from '../../scan-registry'
import { rememberPlan } from '../../plan-registry'
import { createJob, finishJob } from '../../jobs'
import { detectDuplicates } from '../../duplicates/detector'
import { generateRawPlan } from '../../providers/orchestrator'
import { createConfiguredProvider } from '../../providers/factory'
import { validatePlan } from '../../plan/validate'

const strategySchema = z.object({
  id: z.enum(['smart', 'fileType', 'date', 'custom']),
  dateGranularity: z.enum(['year', 'year-month']).optional(),
  customInstruction: z.string().max(4000).optional(),
  reuseExistingFolders: z.boolean()
})

const analysisRequestSchema = z.object({
  scanId: z.string().min(1),
  strategy: strategySchema,
  inclusionChoices: z.record(z.string(), z.enum(['include', 'skip'])),
  reorganizeEverything: z.boolean()
})

export function registerAnalysisHandlers(): void {
  handle('analysis:start', analysisRequestSchema, async (req): Promise<AnalysisResult> => {
    const scan = getScan(req.scanId)
    if (!scan) {
      throw new OrdinoFailure('SCAN_FAILED', 'Scan expired — pick the folder again', {
        retryable: true
      })
    }

    // Include/skip gates what the AI sees and what can move (P0-2); skipped
    // folders stay listed as destinations by reference (Open Q2).
    const inScope: ScanFile[] = scan.files.filter((f) => fileIsIncluded(f, req.inclusionChoices))

    // Re-run diff (§5.7): manifest-organized files leave the organize set.
    // Until the manifest store lands (M7) every in-scope file organizes.
    const organizedIds = new Set<string>(
      req.reorganizeEverything ? [] : (scan.rerun?.organizedFileIds ?? [])
    )
    const organizeSet = inScope.filter((f) => !organizedIds.has(f.id))

    if (organizeSet.length === 0 && scan.rerun) {
      return { nothingToDo: true, rerun: scan.rerun }
    }
    if (organizeSet.length === 0) {
      throw new OrdinoFailure('PLAN_EMPTY', 'No files in scope to organize')
    }

    const provider = await createConfiguredProvider()
    const { jobId, signal } = createJob()

    const existingFolders = scan.dirs.map((d) => d.relPath)
    const preferredDestinations = req.reorganizeEverything ? [] : (scan.rerun?.managedFolders ?? [])

    emit('analysis:progress', {
      jobId,
      phase: 'preparing',
      filesAnalyzed: 0,
      filesTotal: organizeSet.length,
      chunk: { current: 0, total: 1 }
    })

    try {
      const [rawPlan, duplicateGroups] = await Promise.all([
        generateRawPlan(
          provider,
          {
            strategy: req.strategy,
            rootName: scan.rootName,
            files: organizeSet,
            existingFolders,
            preferredDestinations
          },
          signal,
          (p) =>
            emit('analysis:progress', {
              jobId,
              phase: p.phase,
              filesAnalyzed: p.filesAnalyzed,
              filesTotal: p.filesTotal,
              chunk: p.chunk
            })
        ),
        detectDuplicates(scan.rootPath, organizeSet, {
          signal,
          organizedIds,
          onProgress: (u) =>
            emit('duplicates:progress', {
              jobId,
              candidates: u.candidates,
              hashed: u.hashed,
              totalBytes: u.totalBytes,
              hashedBytes: u.hashedBytes,
              done: u.done
            })
        })
      ])

      emit('analysis:progress', {
        jobId,
        phase: 'assembling',
        filesAnalyzed: organizeSet.length,
        filesTotal: organizeSet.length,
        chunk: { current: 1, total: 1 }
      })

      const validated = validatePlan(rawPlan, {
        validSources: new Set(organizeSet.map((f) => f.relPath)),
        existingFolders: new Set(existingFolders)
      })

      const movedIds = new Set(validated.moves.map((m) => m.fileId))
      const plan: Plan = {
        planId: randomUUID(),
        scanId: scan.scanId,
        rootPath: scan.rootPath,
        strategy: req.strategy,
        newFolders: validated.newFolders,
        moves: validated.moves,
        unchangedFileIds: organizeSet.filter((f) => !movedIds.has(f.id)).map((f) => f.id),
        organizedFileIds: [...organizedIds],
        duplicateGroups,
        warnings: validated.warnings
      }
      rememberPlan(plan)
      return { nothingToDo: false, plan }
    } finally {
      finishJob(jobId)
    }
  })
}
