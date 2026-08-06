import { z } from 'zod'
import { handle } from '../typed-ipc'
import { listRecents } from '../../settings/recents'
import { readFolderSettings, writeFolderSettings } from '../../folder-state/store'

const folderPrefsSchema = z.object({
  strategy: z
    .object({
      id: z.enum(['smart', 'fileType', 'date', 'custom']),
      dateGranularity: z.enum(['year', 'year-month']).optional(),
      customInstruction: z.string().max(4000).optional(),
      reuseExistingFolders: z.boolean()
    })
    .optional(),
  inclusionChoices: z.record(z.string(), z.enum(['include', 'skip'])).optional(),
  ignoreGlobs: z.array(z.string()).optional()
})

export function registerRecentsHandlers(): void {
  handle('recents:list', null, () => listRecents())

  handle('prefs:getFolder', z.object({ rootPath: z.string().min(1) }), async ({ rootPath }) => {
    const settings = await readFolderSettings(rootPath)
    if (!settings) return null
    return {
      strategy: settings.strategy,
      inclusionChoices: settings.inclusionChoices,
      ignoreGlobs: settings.ignoreGlobs
    }
  })

  handle(
    'prefs:setFolder',
    z.object({ rootPath: z.string().min(1), prefs: folderPrefsSchema }),
    async ({ rootPath, prefs }) => {
      try {
        const existing = await readFolderSettings(rootPath)
        await writeFolderSettings(rootPath, {
          version: 1,
          strategy: prefs.strategy ?? existing?.strategy,
          inclusionChoices: prefs.inclusionChoices ?? existing?.inclusionChoices,
          ignoreGlobs: prefs.ignoreGlobs ?? existing?.ignoreGlobs
        })
      } catch {
        // Read-only folder: it simply won't remember preferences (P1-4 is
        // best-effort by design).
      }
    }
  )
}
