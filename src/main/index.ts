import { app, shell, BrowserWindow } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'
import icon from '../../resources/icon.png?asset'
import { hydrateProcessEnv } from './util/shell-env'
import { adoptSystemProxy } from './util/system-proxy'
import { registerDialogHandlers } from './ipc/handlers/dialog'
import { registerJobHandlers } from './ipc/handlers/jobs'
import { registerScanHandlers } from './ipc/handlers/scan'
import { registerRecentsHandlers } from './ipc/handlers/recents'
import { registerAnalysisHandlers } from './ipc/handlers/analysis'
import { registerProviderHandlers } from './ipc/handlers/providers'
import { registerSettingsHandlers } from './ipc/handlers/settings'
import { registerApplyHandlers } from './ipc/handlers/apply'
import { registerHistoryHandlers } from './ipc/handlers/history'
import { registerExportHandlers } from './ipc/handlers/export'
import { registerUpdateHandlers } from './updates/updater'

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  electronApp.setAppUserModelId('com.ordino.app')

  // Packaged builds get the icon from the bundle; dev runs would otherwise
  // show Electron's default in the macOS Dock.
  if (is.dev && process.platform === 'darwin') {
    app.dock?.setIcon(icon)
  }

  // GUI launches don't inherit the shell environment — adopt it (PATH, proxy
  // vars from shell init files), then fall back to the OS-level proxy from
  // Network settings. Finally route main-process fetch through the adopted
  // HTTP(S)_PROXY / NO_PROXY. Without this, users who reach their AI
  // provider through a proxy work from a terminal but get failures from a
  // Dock-launched Ordino.
  await hydrateProcessEnv()
  await adoptSystemProxy()
  const proxy =
    process.env.HTTPS_PROXY ?? process.env.https_proxy ?? process.env.HTTP_PROXY ?? process.env.http_proxy
  if (proxy) {
    setGlobalDispatcher(new EnvHttpProxyAgent())
  }
  console.log(`[ordino] outbound proxy: ${proxy ?? 'none'}`)

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  registerDialogHandlers()
  registerJobHandlers()
  registerScanHandlers()
  registerRecentsHandlers()
  registerAnalysisHandlers()
  registerProviderHandlers()
  registerSettingsHandlers()
  registerApplyHandlers()
  registerHistoryHandlers()
  registerExportHandlers()
  registerUpdateHandlers()

  createWindow()

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
