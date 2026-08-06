/**
 * Error codes cross IPC instead of raw messages so the renderer can localize
 * them (P2-5 prep). `message` is a developer-readable fallback shown only when
 * no locale string exists for the code.
 */
export type OrdinoErrorCode =
  | 'SCAN_FAILED'
  | 'SCAN_NOT_FOUND'
  | 'FOLDER_NOT_DIRECTORY'
  | 'FOLDER_NOT_READABLE'
  | 'FOLDER_STATE_NOT_WRITABLE'
  | 'PROVIDER_NOT_CONFIGURED'
  | 'PROVIDER_UNREACHABLE'
  | 'PROVIDER_AUTH_FAILED'
  | 'PROVIDER_BAD_ENDPOINT'
  | 'PROVIDER_TIMEOUT'
  | 'CLAUDE_NOT_INSTALLED'
  | 'CLAUDE_NOT_AUTHENTICATED'
  | 'CLAUDE_SPAWN_FAILED'
  | 'PLAN_MALFORMED'
  | 'PLAN_EMPTY'
  | 'ANALYSIS_CANCELLED'
  | 'APPLY_IN_PROGRESS'
  | 'APPLY_FAILED'
  | 'UNDO_NOT_AVAILABLE'
  | 'UNDO_FAILED'
  | 'JOURNAL_CORRUPT'
  | 'SETTINGS_WRITE_FAILED'
  | 'SECRET_STORE_UNAVAILABLE'
  | 'EXPORT_FAILED'
  | 'UPDATE_FAILED'
  | 'INVALID_REQUEST'
  | 'INTERNAL'

export interface OrdinoError {
  code: OrdinoErrorCode
  /** Developer-readable fallback; renderer prefers the locale string for `code`. */
  message: string
  /** Whether retrying the same action may succeed (network blips, busy files…). */
  retryable: boolean
  /** Extra context for display or logs (e.g. the offending path or HTTP status). */
  detail?: string
}

/**
 * Every ipcRenderer.invoke response is wrapped in this envelope: thrown Errors
 * are mangled by Electron's serialization, so structured errors must travel as
 * data.
 */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: OrdinoError }

export function ok<T>(data: T): IpcResult<T> {
  return { ok: true, data }
}

export function err<T = never>(
  code: OrdinoErrorCode,
  message: string,
  opts: { retryable?: boolean; detail?: string } = {}
): IpcResult<T> {
  return {
    ok: false,
    error: { code, message, retryable: opts.retryable ?? false, detail: opts.detail }
  }
}

/** Narrowing helper for code that wants to throw on error envelopes. */
export function unwrap<T>(result: IpcResult<T>): T {
  if (result.ok) return result.data
  const e = new Error(result.error.message)
  ;(e as Error & { ordino: OrdinoError }).ordino = result.error
  throw e
}
