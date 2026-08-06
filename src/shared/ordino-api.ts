import type { IpcChannel, IpcEventChannel, IpcEventMap, IpcReq, IpcRes } from './ipc-contract'

export type Unsubscribe = () => void

/**
 * The surface preload exposes as `window.ordino`, and the exact interface the
 * dev-time mock implements — contract drift between mock and main is a compile
 * error.
 */
export interface OrdinoApi {
  invoke<K extends IpcChannel>(channel: K, req: IpcReq<K>): Promise<IpcRes<K>>
  on<K extends IpcEventChannel>(channel: K, cb: (payload: IpcEventMap[K]) => void): Unsubscribe
  /** Resolves the absolute path of a dropped File (Electron webUtils). */
  getPathForFile(file: File): string
}
