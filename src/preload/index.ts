import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type { OrdinoApi } from '@shared/ordino-api'
import { IPC_EVENT_CHANNELS } from '@shared/ipc-contract'

/**
 * Runs sandboxed: only bundled code + the electron preload APIs. The renderer
 * gets exactly one bridge object; all typing lives in the shared contract.
 */
const eventChannels = new Set<string>(IPC_EVENT_CHANNELS)

const ordino: OrdinoApi = {
  invoke: (channel, req) => ipcRenderer.invoke(channel, req),
  on: (channel, cb) => {
    if (!eventChannels.has(channel)) {
      throw new Error(`Unknown event channel: ${channel}`)
    }
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown): void => {
      cb(payload as never)
    }
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  },
  getPathForFile: (file) => webUtils.getPathForFile(file)
}

contextBridge.exposeInMainWorld('ordino', ordino)
