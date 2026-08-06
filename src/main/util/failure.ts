import type { OrdinoErrorCode } from '@shared/errors'

/**
 * Throw this from any IPC handler to send a typed, localizable error to the
 * renderer. Anything else thrown becomes an INTERNAL error.
 */
export class OrdinoFailure extends Error {
  readonly code: OrdinoErrorCode
  readonly retryable: boolean
  readonly detail?: string

  constructor(
    code: OrdinoErrorCode,
    message: string,
    opts: { retryable?: boolean; detail?: string; cause?: unknown } = {}
  ) {
    super(message, opts.cause !== undefined ? { cause: opts.cause } : undefined)
    this.name = 'OrdinoFailure'
    this.code = code
    this.retryable = opts.retryable ?? false
    this.detail = opts.detail
  }
}

export function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === 'AbortError' || e.message === 'The operation was aborted')
}
