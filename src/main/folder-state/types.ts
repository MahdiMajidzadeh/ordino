import type { StrategyConfig } from '@shared/strategies'
import type { SkippedFile } from '@shared/types'

/**
 * Per-folder persistent state, all living under <root>/.ordino/ so it travels
 * with the folder (survives renames, works across machines).
 */

export type JournalMoveStatus = 'pending' | 'moved' | 'skipped' | 'failed' | 'restored'
export type JournalTrashStatus = 'pending' | 'staged' | 'os-trashed' | 'restored' | 'failed'
export type JournalOperationStatus = 'pending' | 'applied' | 'partial' | 'undone' | 'finalized'

export interface JournalMove {
  source: string
  requestedDestination: string
  finalDestination?: string
  status: JournalMoveStatus
  reasonCode?: SkippedFile['reasonCode']
  detail?: string
  postMoveSize?: number
  postMoveMtimeMs?: number
}

export interface JournalTrash {
  source: string
  /** Rel path inside .ordino/trash/ where the file is staged. */
  stagedAt?: string
  status: JournalTrashStatus
  detail?: string
}

export interface JournalOperation {
  id: string
  startedAt: number
  finishedAt?: number
  strategy: StrategyConfig
  status: JournalOperationStatus
  /** Folders Ordino created during this apply, creation order, rel paths. */
  createdFolders: string[]
  moves: JournalMove[]
  trashes: JournalTrash[]
}

/** Append-only operation log (P2-2 format from day one). */
export interface JournalFile {
  version: 1
  operations: JournalOperation[]
}

/** Organized-state manifest (§5.7). */
export interface ManifestFile {
  version: 1
  strategy: StrategyConfig
  updatedAt: number
  /** Folders Ordino created that it still manages. */
  managedFolders: string[]
  files: Record<string, { size: number; mtimeMs: number; organizedAt: number }>
}

/** Per-folder preferences (P1-4). */
export interface FolderSettingsFile {
  version: 1
  strategy?: StrategyConfig
  inclusionChoices?: Record<string, 'include' | 'skip'>
  ignoreGlobs?: string[]
}
