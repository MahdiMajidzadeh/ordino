import type { AgentFileEntry } from '@shared/plan-schema'
import type { ProviderId } from '@shared/types'
import type { StrategyConfig } from '@shared/strategies'

export interface ChunkRequest {
  strategy: StrategyConfig
  rootName: string
  files: AgentFileEntry[]
  /** Folders that exist on disk (included + skipped-by-reference). */
  existingFolders: string[]
  /** Ordino-managed folders from previous runs — strongly preferred (§5.7). */
  preferredDestinations: string[]
  /** Folder names already decided by earlier chunks this run. */
  priorDecidedFolders: string[]
}

export interface RepairContext {
  previousOutput: string
  errors: string[]
}

export interface ChunkCallContext {
  signal: AbortSignal
  /** Rough within-chunk progress: number of moves seen in the stream so far. */
  onStreamedMoves?: (count: number) => void
}

/**
 * A provider turns one chunk request into raw model text. Parsing, salvage,
 * validation, repair and assembly all live in the orchestrator so behavior is
 * identical across providers (§5.4).
 */
export interface OrganizerProvider {
  readonly id: ProviderId
  generateChunkPlan(req: ChunkRequest, ctx: ChunkCallContext, repair?: RepairContext): Promise<string>
}
