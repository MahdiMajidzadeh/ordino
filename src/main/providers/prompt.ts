import type { AgentFileEntry } from '@shared/plan-schema'
import type { StrategyConfig } from '@shared/strategies'
import type { ChunkRequest, RepairContext } from './types'

/**
 * Shared prompt builder — both providers send exactly this content, so plan
 * quality varies by model but never by app flow (§5.4).
 */

export const SYSTEM_PROMPT = `You are a file-organization planner. You receive a list of files (paths and metadata only — never contents) from ONE root folder, and you propose where each file should move WITHIN that root folder.

Rules:
- Respond with ONLY a JSON object, no prose, no markdown fences.
- Shape: {"newFolders": ["FolderName", ...], "moves": [{"source": "<exact path from the manifest>", "destination": "<Folder/filename.ext>", "reason": "<short reason, max 12 words>"}, ...]}
- "source" must be copied EXACTLY from the manifest. Never invent files.
- Never rename files: the filename (last path segment) of "destination" must equal the filename of "source".
- All paths are relative to the root folder. Never use "..", absolute paths, or drive letters.
- Prefer the folders listed as PREFERRED or EXISTING when a file fits one; only propose a new folder when nothing existing fits. List every folder you introduce in "newFolders".
- Keep the folder set small and coherent: aim for 5-15 folders total, not one folder per file.
- A file already in the right place should simply be omitted from "moves".
- Folder names: short, human, Title Case, no special characters.`

function strategyInstruction(strategy: StrategyConfig): string {
  switch (strategy.id) {
    case 'smart':
      return 'STRATEGY: Smart Categories. Infer each file\'s purpose from its name, extension and dates, and group files into semantic categories (e.g. "Invoices", "Screenshots", "3D Models", "Music", "Code"). Files that clearly belong together go together even when their names differ.'
    case 'fileType':
      return 'STRATEGY: File Type. Group strictly by extension family into: Documents, Images, Video, Audio, Archives, Code, Other. Use only these folder names (plus existing folders when they fit).'
    case 'date':
      return strategy.dateGranularity === 'year-month'
        ? 'STRATEGY: Date. Group by creation date into folders named "YYYY/MM" (year folder containing zero-padded month subfolders), e.g. "2026/03".'
        : 'STRATEGY: Date. Group by creation year into folders named "YYYY", e.g. "2026".'
    case 'custom':
      return `STRATEGY: Custom instruction from the user — follow it exactly as written:\n"""${strategy.customInstruction ?? ''}"""`
  }
}

function manifestLines(files: AgentFileEntry[]): string {
  // Compact one-line-per-file JSON keeps token cost low while preserving
  // everything the model may key on. contentExcerpt reserved for P2-1.
  return files
    .map((f) =>
      JSON.stringify({
        path: f.relPath,
        kb: Math.max(1, Math.round(f.size / 1024)),
        created: f.createdAt,
        modified: f.modifiedAt,
        ...(f.contentExcerpt ? { excerpt: f.contentExcerpt } : {})
      })
    )
    .join('\n')
}

export function buildUserMessage(req: ChunkRequest): string {
  const parts: string[] = []
  parts.push(strategyInstruction(req.strategy))

  if (!req.strategy.reuseExistingFolders) {
    parts.push(
      'The user prefers NEW folders: only reuse an existing folder when it is an obviously perfect fit.'
    )
  }
  if (req.preferredDestinations.length > 0) {
    parts.push(
      `PREFERRED destinations (created by a previous organization run — reuse these whenever a file fits; do not invent parallel categories):\n${req.preferredDestinations.join('\n')}`
    )
  }
  if (req.existingFolders.length > 0) {
    parts.push(`EXISTING folders in the root (usable as destinations):\n${req.existingFolders.join('\n')}`)
  }
  if (req.priorDecidedFolders.length > 0) {
    parts.push(
      `Folders already decided for other files in this same run (stay consistent with them):\n${req.priorDecidedFolders.join('\n')}`
    )
  }
  parts.push(`Root folder name: ${req.rootName}`)
  parts.push(`FILES (one JSON object per line):\n${manifestLines(req.files)}`)
  parts.push('Respond with the JSON plan now.')
  return parts.join('\n\n')
}

export function buildRepairMessage(repair: RepairContext): string {
  return [
    'Your previous response could not be used. Problems found:',
    ...repair.errors.map((e) => `- ${e}`),
    '',
    'Your previous response was:',
    repair.previousOutput.slice(0, 4000),
    '',
    'Respond again with ONLY the corrected JSON object — same schema, no prose, no fences.'
  ].join('\n')
}
