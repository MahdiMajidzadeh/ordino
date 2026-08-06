import { app } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateStatus } from '@shared/types'
import { handle, emit } from '../ipc/typed-ipc'
import { OrdinoFailure } from '../util/failure'

const { autoUpdater } = electronUpdater

/**
 * Auto-update scaffold (Phase 3): renderer-triggered check + install, status
 * pushed over update:status. Downloads never start on their own, and the
 * whole feature is inert in dev builds.
 */
let lastStatus: UpdateStatus = { state: 'idle' }

function setStatus(status: UpdateStatus): void {
  lastStatus = status
  emit('update:status', status)
}

export function registerUpdateHandlers(): void {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => setStatus({ state: 'checking' }))
  autoUpdater.on('update-available', (info) => setStatus({ state: 'available', version: info.version }))
  autoUpdater.on('update-not-available', () => setStatus({ state: 'none' }))
  autoUpdater.on('download-progress', () => setStatus({ ...lastStatus, state: 'downloading' }))
  autoUpdater.on('update-downloaded', (info) =>
    setStatus({ state: 'downloaded', version: info.version })
  )
  autoUpdater.on('error', (e) => setStatus({ state: 'error', detail: e.message }))

  handle('updates:check', null, async (): Promise<UpdateStatus> => {
    if (!app.isPackaged) return { state: 'none', detail: 'dev build' }
    try {
      await autoUpdater.checkForUpdates()
    } catch (e) {
      throw new OrdinoFailure('UPDATE_FAILED', 'Update check failed', {
        retryable: true,
        detail: e instanceof Error ? e.message : undefined
      })
    }
    return lastStatus
  })

  handle('updates:install', null, async () => {
    if (!app.isPackaged) return
    if (lastStatus.state === 'available') {
      await autoUpdater.downloadUpdate()
      return
    }
    if (lastStatus.state === 'downloaded') {
      autoUpdater.quitAndInstall()
    }
  })
}
