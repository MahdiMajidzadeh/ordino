import type { IpcResult } from './errors'
import type {
  AnalysisProgress,
  AnalysisRequest,
  AnalysisResult,
  AppInfo,
  ApplyProgress,
  ApplyRequest,
  ApplyResult,
  ClaudeDetection,
  DuplicatesProgress,
  ExportRequest,
  ExportResult,
  FolderPrefs,
  GlobalSettings,
  HistoryDetail,
  HistoryEntry,
  ModelListResult,
  OpenAiCompatConfig,
  ProviderId,
  QuickScanSummary,
  RecentFolder,
  ScanResult,
  TestConnectionResult,
  UpdateStatus
} from './types'

/**
 * Single source of truth for request/response channels. Every response is an
 * IpcResult envelope; the preload unwraps nothing — the renderer handles both
 * arms so errors keep their codes.
 */
export interface IpcInvokeMap {
  'app:info': { req: void; res: AppInfo }
  'dialog:pickFolder': { req: void; res: string | null }
  'scan:quick': { req: { rootPath: string }; res: QuickScanSummary }
  'scan:folder': { req: { rootPath: string }; res: ScanResult }
  'analysis:start': { req: AnalysisRequest; res: AnalysisResult }
  'job:cancel': { req: { jobId: string }; res: void }
  'apply:start': { req: ApplyRequest; res: ApplyResult }
  'undo:status': { req: { rootPath: string }; res: import('./types').UndoAvailability }
  'undo:last': { req: { rootPath: string }; res: import('./types').UndoResult }
  'history:list': { req: void; res: HistoryEntry[] }
  'history:get': { req: { rootPath: string; operationId: string }; res: HistoryDetail }
  'export:plan': { req: ExportRequest; res: ExportResult }
  'settings:get': { req: void; res: GlobalSettings }
  'settings:set': { req: Partial<GlobalSettings>; res: GlobalSettings }
  'secrets:setKey': { req: { provider: ProviderId; apiKey: string }; res: void }
  'secrets:clearKey': { req: { provider: ProviderId }; res: void }
  'provider:detectClaude': { req: void; res: ClaudeDetection }
  'provider:testConnection': {
    req:
      | { provider: 'claude-cli'; model: string; apiKey?: string }
      | ({ provider: 'openai-compat' } & OpenAiCompatConfig)
    res: TestConnectionResult
  }
  'provider:listModels': {
    req: { provider: 'claude-cli' } | ({ provider: 'openai-compat' } & Omit<OpenAiCompatConfig, 'model'>)
    res: ModelListResult
  }
  'prefs:getFolder': { req: { rootPath: string }; res: FolderPrefs | null }
  'prefs:setFolder': { req: { rootPath: string; prefs: FolderPrefs }; res: void }
  'recents:list': { req: void; res: RecentFolder[] }
  'shell:reveal': { req: { path: string }; res: void }
  'shell:openExternal': { req: { url: string }; res: void }
  'updates:check': { req: void; res: UpdateStatus }
  'updates:install': { req: void; res: void }
}

export type IpcChannel = keyof IpcInvokeMap
export type IpcReq<K extends IpcChannel> = IpcInvokeMap[K]['req']
export type IpcRes<K extends IpcChannel> = IpcResult<IpcInvokeMap[K]['res']>

/** Fire-and-forget push channels, main → renderer. */
export interface IpcEventMap {
  'analysis:progress': AnalysisProgress
  'duplicates:progress': DuplicatesProgress
  'apply:progress': ApplyProgress
  'update:status': UpdateStatus
}

export type IpcEventChannel = keyof IpcEventMap

export const IPC_EVENT_CHANNELS: readonly IpcEventChannel[] = [
  'analysis:progress',
  'duplicates:progress',
  'apply:progress',
  'update:status'
]
