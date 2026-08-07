import { app, shell, BrowserWindow, Menu } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { startNetworkBootstrap } from './util/net-bootstrap'
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

/**
 * Must run before anything reads app.getPath('userData'), which is derived
 * from the app name. Dev builds would otherwise use the lowercase package
 * name while packaged builds use productName — the same folder on macOS but
 * two different ones on Linux.
 */
app.setName('Ordino')

/**
 * macOS shows the bundle's name in the menu bar, which is "Electron" for a
 * dev run. An explicit menu built from roles fixes the name while keeping
 * every standard shortcut — the settings and custom-instruction fields need
 * working copy/paste.
 */
function buildAppMenu(): void {
  if (process.platform !== 'darwin') {
    Menu.setApplicationMenu(null) // Windows/Linux use autoHideMenuBar
    return
  }
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' }
    ])
  )
}

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
  buildAppMenu()
  app.setAboutPanelOptions({
    applicationName: 'Ordino',
    applicationVersion: app.getVersion(),
    copyright: 'Organize files with AI'
  })

  // Packaged builds get the icon from the bundle; dev runs would otherwise
  // show Electron's default in the macOS Dock.
  if (is.dev && process.platform === 'darwin') {
    app.dock?.setIcon(icon)
  }

  // Deliberately not awaited — see net-bootstrap for why the window must not
  // wait on a login shell.
  startNetworkBootstrap()
  console.log(`[ordino] name=${app.getName()} userData=${app.getPath('userData')}`)

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
