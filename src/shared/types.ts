import type { StrategyConfig } from './strategies'

// ---------------------------------------------------------------------------
// Scan
// ---------------------------------------------------------------------------

/** A file as the renderer sees it. `id` is the root-relative POSIX path. */
export interface ScanFile {
  id: string
  relPath: string
  name: string
  /** Lowercased extension without the dot; '' when none. */
  ext: string
  size: number
  /** Epoch milliseconds. */
  createdAt: number
  modifiedAt: number
  /** POSIX rel path of the containing dir; '' for the root itself. */
  parentDir: string
  isSymlink: boolean
}

export interface ScanDir {
  relPath: string
  name: string
  /** '' when the parent is the root; null only for the synthetic root row. */
  parentDir: string | null
  /** Direct file children. */
  fileCount: number
  /** Files in this dir and all descendants. */
  totalFileCount: number
  depth: number
  /** True when the folder appears in the .ordino manifest as Ordino-created. */
  managedByOrdino: boolean
}

/** Shown right after picking a folder (P0-1), before the full scan lands. */
export interface QuickScanSummary {
  rootPath: string
  rootName: string
  fileCount: number
  dirCount: number
  totalSize: number
}

/** Re-run diff computed against the folder's .ordino manifest (§5.7). */
export interface RerunDiff {
  manifestStrategy: StrategyConfig
  /** Files still at their organized destination — excluded from planning. */
  organizedFileIds: string[]
  /** Ordino-managed folders that still exist. */
  managedFolders: string[]
  /** Files the manifest doesn't recognize — the organize set. */
  newFileIds: string[]
  nothingToDo: boolean
  lastAppliedAt: number
}

export interface ScanWarning {
  relPath: string
  reasonCode: 'unreadable' | 'stat-failed'
  detail?: string
}

export interface ScanResult {
  scanId: string
  rootPath: string
  rootName: string
  files: ScanFile[]
  dirs: ScanDir[]
  totalSize: number
  /** Hidden/system/glob-ignored entries that were dropped. */
  ignoredCount: number
  warnings: ScanWarning[]
  rerun: RerunDiff | null
}

export type InclusionChoice = 'include' | 'skip'

// ---------------------------------------------------------------------------
// Analysis & plan
// ---------------------------------------------------------------------------

export interface AnalysisRequest {
  scanId: string
  strategy: StrategyConfig
  /** Explicit per-dir choices; unlisted dirs inherit their nearest listed ancestor, default include. */
  inclusionChoices: Record<string, InclusionChoice>
  /** Ignore the .ordino manifest and treat the folder as fresh (§5.7 escape hatch). */
  reorganizeEverything: boolean
}

export type AnalysisPhase = 'preparing' | 'analyzing' | 'repairing' | 'assembling'

export interface AnalysisProgress {
  jobId: string
  phase: AnalysisPhase
  filesAnalyzed: number
  filesTotal: number
  chunk: { current: number; total: number }
}

export interface DuplicatesProgress {
  jobId: string
  candidates: number
  hashed: number
  totalBytes: number
  hashedBytes: number
  done: boolean
}

export interface PlanMove {
  fileId: string
  /** Root-relative POSIX path of the file today. */
  source: string
  /** Root-relative POSIX destination path (same basename — no renames in v1). */
  destination: string
  /** Root-relative POSIX path of the destination folder. */
  destFolder: string
  /** The model's one-line reason; '' when unavailable. */
  reason: string
}

export type KeeperReasonCode = 'organized' | 'clean-name' | 'oldest' | 'shortest-path'

export interface DuplicateGroup {
  id: string
  size: number
  fileIds: string[]
  recommendedKeeperId: string
  keeperReasonCode: KeeperReasonCode
}

export interface PlanWarning {
  code: 'unknown-source-dropped' | 'destination-rewritten' | 'folder-name-sanitized'
  detail: string
}

export interface Plan {
  planId: string
  scanId: string
  rootPath: string
  strategy: StrategyConfig
  newFolders: string[]
  moves: PlanMove[]
  /** Files in scope but not moved by the plan (already in place / no better home). */
  unchangedFileIds: string[]
  /** Files excluded because the manifest says they're already organized. */
  organizedFileIds: string[]
  duplicateGroups: DuplicateGroup[]
  warnings: PlanWarning[]
}

export type AnalysisResult = { nothingToDo: true; rerun: RerunDiff } | { nothingToDo: false; plan: Plan }

// ---------------------------------------------------------------------------
// Apply, undo, history
// ---------------------------------------------------------------------------

export interface ApplyMoveRequest {
  fileId: string
  source: string
  destination: string
}

export interface ApplyTrashRequest {
  fileId: string
  path: string
}

export interface ApplyRequest {
  rootPath: string
  planId: string
  strategy: StrategyConfig
  /** Final post-decision moves (exclusions and reassignments already applied). */
  moves: ApplyMoveRequest[]
  /** Duplicates the user chose to trash. */
  trash: ApplyTrashRequest[]
  newFolders: string[]
}

export interface ApplyProgress {
  operationId: string
  done: number
  total: number
  currentRelPath: string
  stage: 'moving' | 'trashing' | 'restoring'
}

export interface SkippedFile {
  path: string
  reasonCode: 'locked' | 'permission' | 'missing' | 'occupied' | 'modified' | 'unknown'
  detail?: string
}

export interface CollisionNote {
  from: string
  requested: string
  finalDestination: string
}

export interface ApplyResult {
  operationId: string
  moved: number
  trashed: number
  skipped: SkippedFile[]
  failed: SkippedFile[]
  collisions: CollisionNote[]
}

export interface UndoAvailability {
  available: boolean
  operationId?: string
  appliedAt?: number
  moveCount?: number
  trashCount?: number
  /** True when the op is a crash-recovery candidate (was still pending). */
  recovery?: boolean
}

export interface UndoResult {
  operationId: string
  restored: number
  restoredFromTrash: number
  removedFolders: number
  notRestored: SkippedFile[]
}

export interface HistoryEntry {
  id: string
  rootPath: string
  rootName: string
  appliedAt: number
  strategy: StrategyConfig
  moved: number
  trashed: number
  skipped: number
  failed: number
  status: 'applied' | 'partial' | 'undone' | 'finalized' | 'pending'
  undoable: boolean
}

export interface HistoryOp {
  kind: 'move' | 'trash'
  from: string
  to?: string
  status: string
}

export interface HistoryDetail extends HistoryEntry {
  ops: HistoryOp[]
}

// ---------------------------------------------------------------------------
// Providers & settings
// ---------------------------------------------------------------------------

export type ProviderId = 'claude-cli' | 'openai-compat'

export interface ClaudeDetection {
  installed: boolean
  /** Absolute path of the binary in use (detected or manual override). */
  path?: string
  version?: string
  source?: 'override' | 'path' | 'well-known'
}

export interface OpenAiCompatConfig {
  baseUrl: string
  model: string
  /** Transient — only for test-connection/list-models on unsaved values. */
  apiKey?: string
  useStoredKey?: boolean
}

export interface TestConnectionResult {
  latencyMs: number
  model?: string
  version?: string
}

export interface ModelListResult {
  models: string[]
  source: 'curated' | 'endpoint'
}

export interface GlobalSettings {
  version: number
  provider: ProviderId
  claude: {
    model: string
    /** Manual path override for the claude binary; empty = auto-detect. */
    cliPathOverride: string
    hasApiKeyOverride: boolean
  }
  openaiCompat: {
    baseUrl: string
    model: string
    hasKey: boolean
  }
  /** Global default ignore globs, overridable per folder. */
  ignoreGlobs: string[]
  lastStrategy: StrategyConfig
}

/** Per-folder prefs persisted in <root>/.ordino/settings.json (P1-4). */
export interface FolderPrefs {
  strategy?: StrategyConfig
  inclusionChoices?: Record<string, InclusionChoice>
  ignoreGlobs?: string[]
}

export interface RecentFolder {
  path: string
  name: string
  lastUsedAt: number
  hasManifest: boolean
}

// ---------------------------------------------------------------------------
// Export & updates
// ---------------------------------------------------------------------------

export type ExportFormat = 'json' | 'markdown'

export interface ExportRequest {
  planId: string
  format: ExportFormat
  /** Effective moves after user decisions, so the export matches the review. */
  moves: ApplyMoveRequest[]
  trash: ApplyTrashRequest[]
  newFolders: string[]
  summary: string
}

export type ExportResult = { savedPath: string } | { canceled: true }

export interface UpdateStatus {
  state: 'idle' | 'checking' | 'available' | 'none' | 'downloading' | 'downloaded' | 'error'
  version?: string
  detail?: string
}

/** Build identity, shown in Settings → About. */
export interface AppInfo {
  /** package.json version — CI rewrites it from the pushed git tag. */
  version: string
  /** The exact tag the release was built from; absent in local builds. */
  buildRef?: string
  isPackaged: boolean
  platform: NodeJS.Platform
  arch: string
  electron: string
}
