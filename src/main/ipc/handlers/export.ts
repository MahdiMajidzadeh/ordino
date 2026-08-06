import { BrowserWindow, dialog } from 'electron'
import { promises as fs } from 'fs'
import { z } from 'zod'
import type { ExportRequest } from '@shared/types'
import { handle } from '../typed-ipc'
import { OrdinoFailure } from '../../util/failure'
import { getPlan } from '../../plan-registry'

const exportSchema = z.object({
  planId: z.string().min(1),
  format: z.enum(['json', 'markdown']),
  moves: z.array(z.object({ fileId: z.string(), source: z.string(), destination: z.string() })),
  trash: z.array(z.object({ fileId: z.string(), path: z.string() })),
  newFolders: z.array(z.string()),
  summary: z.string().max(2000)
})

function renderMarkdown(req: ExportRequest, rootPath: string): string {
  const lines: string[] = [
    `# Ordino plan — ${rootPath}`,
    '',
    `> ${req.summary}`,
    '',
    '## New folders',
    ...(req.newFolders.length > 0 ? req.newFolders.map((f) => `- \`${f}/\``) : ['_none_']),
    '',
    '## Moves',
    '| From | To |',
    '|---|---|',
    ...req.moves.map((m) => `| \`${m.source}\` | \`${m.destination}\` |`)
  ]
  if (req.trash.length > 0) {
    lines.push('', '## Duplicates to Trash', ...req.trash.map((t) => `- \`${t.path}\``))
  }
  lines.push('', `_Exported ${new Date().toISOString()} — nothing has been applied._`)
  return lines.join('\n')
}

/** P1-3: dry-run export — save the reviewed plan without touching anything. */
export function registerExportHandlers(): void {
  handle('export:plan', exportSchema, async (req) => {
    const plan = getPlan(req.planId)
    if (!plan) throw new OrdinoFailure('EXPORT_FAILED', 'Plan expired — analyze again', { retryable: true })

    const win = BrowserWindow.getAllWindows()[0]
    const ext = req.format === 'json' ? 'json' : 'md'
    const options: Electron.SaveDialogOptions = {
      defaultPath: `ordino-plan-${new Date().toISOString().slice(0, 10)}.${ext}`,
      filters:
        req.format === 'json'
          ? [{ name: 'JSON', extensions: ['json'] }]
          : [{ name: 'Markdown', extensions: ['md'] }]
    }
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { canceled: true as const }

    const content =
      req.format === 'json'
        ? JSON.stringify(
            {
              exportedAt: new Date().toISOString(),
              rootPath: plan.rootPath,
              strategy: plan.strategy,
              summary: req.summary,
              newFolders: req.newFolders,
              moves: req.moves.map(({ source, destination }) => ({ source, destination })),
              trash: req.trash.map((t) => t.path),
              applied: false
            },
            null,
            2
          )
        : renderMarkdown(req, plan.rootPath)

    try {
      await fs.writeFile(result.filePath, content, 'utf8')
    } catch (e) {
      throw new OrdinoFailure('EXPORT_FAILED', 'Could not write the export file', {
        retryable: true,
        detail: e instanceof Error ? e.message : undefined
      })
    }
    return { savedPath: result.filePath }
  })
}
