import { BrowserWindow, ipcMain } from 'electron'
import type { z } from 'zod'
import type { IpcChannel, IpcEventChannel, IpcEventMap, IpcInvokeMap, IpcReq } from '@shared/ipc-contract'
import { err, ok } from '@shared/errors'
import { OrdinoFailure, isAbortError } from '../util/failure'

/**
 * Type-safe ipcMain.handle: the request is zod-validated (the renderer is
 * untrusted in Electron's security model) and the response is always an
 * IpcResult envelope — handlers just return data or throw OrdinoFailure.
 */
export function handle<K extends IpcChannel>(
  channel: K,
  schema: z.ZodType<IpcReq<K>> | null,
  fn: (req: IpcReq<K>) => Promise<IpcInvokeMap[K]['res']>
): void {
  ipcMain.handle(channel, async (_event, rawReq: unknown) => {
    let req = rawReq as IpcReq<K>
    if (schema) {
      const parsed = schema.safeParse(rawReq)
      if (!parsed.success) {
        return err('INVALID_REQUEST', `Invalid request for ${channel}`, {
          detail: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
        })
      }
      req = parsed.data
    }
    try {
      return ok(await fn(req))
    } catch (e) {
      if (e instanceof OrdinoFailure) {
        return err(e.code, e.message, { retryable: e.retryable, detail: e.detail })
      }
      if (isAbortError(e)) {
        return err('ANALYSIS_CANCELLED', 'The operation was cancelled', { retryable: true })
      }
      const message = e instanceof Error ? e.message : String(e)
      console.error(`[ipc:${channel}]`, e)
      return err('INTERNAL', message, { retryable: false })
    }
  })
}

/** Push an event to every window (Ordino is single-window, but be safe). */
export function emit<K extends IpcEventChannel>(channel: K, payload: IpcEventMap[K]): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload)
  }
}
