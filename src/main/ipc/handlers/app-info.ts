import { app } from 'electron'
import type { AppInfo } from '@shared/types'
import { handle } from '../typed-ipc'

/**
 * `app.getVersion()` reads the packaged package.json, which CI rewrites from
 * the pushed git tag — so a release build reports the tag it was cut from.
 * The raw tag is also baked in at build time, which is what a local build
 * (still on the repo's package.json version) lacks.
 */
const buildRef = import.meta.env.MAIN_VITE_ORDINO_BUILD_REF || undefined

export function registerAppHandlers(): void {
  handle('app:info', null, async (): Promise<AppInfo> => ({
    version: app.getVersion(),
    buildRef,
    isPackaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    electron: process.versions.electron
  }))
}
