import { BrowserWindow, dialog, shell } from 'electron'
import { z } from 'zod'
import { handle } from '../typed-ipc'
import { OrdinoFailure } from '../../util/failure'

export function registerDialogHandlers(): void {
  handle('dialog:pickFolder', null, async () => {
    const win = BrowserWindow.getAllWindows()[0]
    const result = win
      ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
      : await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  handle('shell:reveal', z.object({ path: z.string().min(1) }), async ({ path }) => {
    shell.showItemInFolder(path)
  })

  handle('shell:openExternal', z.object({ url: z.string().min(1) }), async ({ url }) => {
    const parsed = new URL(url)
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      throw new OrdinoFailure('INVALID_REQUEST', `Refusing to open non-http URL: ${url}`)
    }
    await shell.openExternal(url)
  })
}
