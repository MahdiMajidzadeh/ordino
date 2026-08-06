import type { AgentFileEntry, RawPlan } from '@shared/plan-schema'
import { rawPlanSchema } from '@shared/plan-schema'
import type { ScanFile } from '@shared/types'
import type { StrategyConfig } from '@shared/strategies'
import { OrdinoFailure } from '../util/failure'
import { salvageJsonObject } from './json-salvage'
import type { ChunkRequest, OrganizerProvider } from './types'

/**
 * Chunking thresholds. The spec floats 500/350 (§5.4), but a single call
 * producing hundreds of moves means minutes of generation with no batch
 * boundary to show — and one malformed response throws all of it away.
 * 150-file chunks keep every call ~1 minute, make "Batch k of n" progress
 * real, and localize repair cost. ≤200 stays a single call so the spec's
 * 200-file benchmark folder doesn't pay the two-call overhead.
 */
const SINGLE_CALL_LIMIT = 200
const CHUNK_SIZE = 150

export interface OrchestratorInput {
  strategy: StrategyConfig
  rootName: string
  files: ScanFile[]
  existingFolders: string[]
  preferredDestinations: string[]
}

export interface OrchestratorProgress {
  phase: 'analyzing' | 'repairing'
  filesAnalyzed: number
  filesTotal: number
  chunk: { current: number; total: number }
}

function toAgentEntry(file: ScanFile): AgentFileEntry {
  const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
  return {
    relPath: file.relPath,
    name: file.name,
    ext: file.ext,
    size: file.size,
    createdAt: iso(file.createdAt),
    modifiedAt: iso(file.modifiedAt)
  }
}

function chunkFiles(files: ScanFile[]): ScanFile[][] {
  if (files.length <= SINGLE_CALL_LIMIT) return [files]
  // Sort by extension then name so related files co-locate within a chunk —
  // better category coherence than manifest order.
  const sorted = [...files].sort(
    (a, b) => a.ext.localeCompare(b.ext) || a.name.localeCompare(b.name)
  )
  const chunks: ScanFile[][] = []
  for (let i = 0; i < sorted.length; i += CHUNK_SIZE) {
    chunks.push(sorted.slice(i, i + CHUNK_SIZE))
  }
  return chunks
}

interface ChunkOutcome {
  plan: RawPlan
}

/**
 * Per-chunk pipeline (Open Q3b, decided): salvage → schema-validate → on
 * failure exactly ONE repair call carrying the errors → on second failure
 * reject the whole analysis as retryable. Never a partial silent plan (P0-4).
 */
async function runChunk(
  provider: OrganizerProvider,
  req: ChunkRequest,
  signal: AbortSignal,
  onStreamedMoves: (count: number) => void,
  onRepairing: () => void
): Promise<ChunkOutcome> {
  const attempt = async (repair?: { previousOutput: string; errors: string[] }): Promise<
    { ok: true; plan: RawPlan } | { ok: false; raw: string; errors: string[] }
  > => {
    const raw = await provider.generateChunkPlan(req, { signal, onStreamedMoves }, repair)
    const salvaged = salvageJsonObject(raw)
    if (!salvaged) {
      return { ok: false, raw, errors: ['Response contained no JSON object.'] }
    }
    let parsed: unknown
    try {
      parsed = JSON.parse(salvaged)
    } catch (e) {
      return { ok: false, raw, errors: [`JSON.parse failed: ${e instanceof Error ? e.message : e}`] }
    }
    const result = rawPlanSchema.safeParse(parsed)
    if (!result.success) {
      return {
        ok: false,
        raw,
        errors: result.error.issues.slice(0, 12).map((i) => `${i.path.join('.')}: ${i.message}`)
      }
    }
    return { ok: true, plan: result.data }
  }

  const first = await attempt()
  if (first.ok) return { plan: first.plan }

  onRepairing()
  const second = await attempt({ previousOutput: first.raw, errors: first.errors })
  if (second.ok) return { plan: second.plan }

  throw new OrdinoFailure('PLAN_MALFORMED', 'The model returned an unusable plan twice', {
    retryable: true,
    detail: second.errors.join('; ')
  })
}

/**
 * Chunked plan generation with cross-chunk category memory. Returns the
 * assembled raw plan; semantic validation against the manifest happens in
 * plan/validate.ts on the whole assembly.
 */
export async function generateRawPlan(
  provider: OrganizerProvider,
  input: OrchestratorInput,
  signal: AbortSignal,
  onProgress: (p: OrchestratorProgress) => void
): Promise<RawPlan> {
  const chunks = chunkFiles(input.files)
  const total = input.files.length
  let analyzedBefore = 0

  const assembled: RawPlan = { newFolders: [], moves: [] }
  const decidedFolders = new Set<string>(input.preferredDestinations)

  for (let c = 0; c < chunks.length; c++) {
    const chunk = chunks[c]
    const req: ChunkRequest = {
      strategy: input.strategy,
      rootName: input.rootName,
      files: chunk.map(toAgentEntry),
      existingFolders: input.existingFolders,
      preferredDestinations: input.preferredDestinations,
      priorDecidedFolders: [...decidedFolders].filter(
        (f) => !input.preferredDestinations.includes(f)
      )
    }

    const report = (phase: 'analyzing' | 'repairing', streamed: number): void =>
      onProgress({
        phase,
        filesAnalyzed: Math.min(total, analyzedBefore + Math.min(streamed, chunk.length)),
        filesTotal: total,
        chunk: { current: c + 1, total: chunks.length }
      })

    report('analyzing', 0)
    const outcome = await runChunk(
      provider,
      req,
      signal,
      (streamed) => report('analyzing', streamed),
      () => report('repairing', 0)
    )

    assembled.moves.push(...outcome.plan.moves)
    for (const folder of outcome.plan.newFolders) {
      assembled.newFolders.push(folder)
      decidedFolders.add(folder)
    }
    for (const move of outcome.plan.moves) {
      const slash = move.destination.lastIndexOf('/')
      if (slash > 0) decidedFolders.add(move.destination.slice(0, slash))
    }

    analyzedBefore += chunk.length
    report('analyzing', chunk.length)
  }

  return assembled
}
