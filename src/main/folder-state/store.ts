import { promises as fs } from 'fs'
import { join } from 'path'
import { OrdinoFailure } from '../util/failure'
import { readJson, writeJsonAtomic } from '../util/atomic-write'
import type { FolderSettingsFile, JournalFile, ManifestFile } from './types'

/** Everything Ordino persists for a folder lives here. */
export const STATE_DIR = '.ordino'

export const stateDir = (root: string): string => join(root, STATE_DIR)
export const journalPath = (root: string): string => join(stateDir(root), 'journal.json')
export const manifestPath = (root: string): string => join(stateDir(root), 'manifest.json')
export const folderSettingsPath = (root: string): string => join(stateDir(root), 'settings.json')
export const trashDir = (root: string, opId?: string): string =>
  opId ? join(stateDir(root), 'trash', opId) : join(stateDir(root), 'trash')

/**
 * Fail fast when the folder can't hold Ordino state — apply would fail on
 * the first move anyway, so surface a clear error before touching anything.
 */
export async function ensureStateDirWritable(root: string): Promise<void> {
  try {
    await fs.mkdir(stateDir(root), { recursive: true })
    const probe = join(stateDir(root), '.write-probe')
    await fs.writeFile(probe, 'ok')
    await fs.rm(probe, { force: true })
  } catch (e) {
    throw new OrdinoFailure('FOLDER_STATE_NOT_WRITABLE', `Cannot write Ordino state into ${root}`, {
      detail: e instanceof Error ? e.message : undefined
    })
  }
}

const EMPTY_JOURNAL: JournalFile = { version: 1, operations: [] }

function looksLikeJournal(value: unknown): value is JournalFile {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as JournalFile).version === 1 &&
    Array.isArray((value as JournalFile).operations)
  )
}

/**
 * Corrupt journals are preserved as .corrupt (never silently deleted) and a
 * fresh journal takes over; the caller may surface JOURNAL_CORRUPT.
 */
export async function readJournal(root: string): Promise<{ journal: JournalFile; corrupt: boolean }> {
  try {
    await fs.access(journalPath(root))
  } catch {
    return { journal: structuredClone(EMPTY_JOURNAL), corrupt: false }
  }
  const parsed = await readJson<unknown>(journalPath(root))
  if (looksLikeJournal(parsed)) return { journal: parsed, corrupt: false }
  try {
    await fs.rename(journalPath(root), `${journalPath(root)}.corrupt-${Date.now()}`)
  } catch {
    // Preservation is best-effort.
  }
  return { journal: structuredClone(EMPTY_JOURNAL), corrupt: true }
}

export async function writeJournal(root: string, journal: JournalFile): Promise<void> {
  await writeJsonAtomic(journalPath(root), journal)
}

export async function readManifest(root: string): Promise<ManifestFile | null> {
  const parsed = await readJson<ManifestFile>(manifestPath(root))
  if (parsed && parsed.version === 1 && typeof parsed.files === 'object') return parsed
  return null
}

export async function writeManifest(root: string, manifest: ManifestFile): Promise<void> {
  await writeJsonAtomic(manifestPath(root), manifest)
}

export async function deleteManifest(root: string): Promise<void> {
  await fs.rm(manifestPath(root), { force: true })
}

export async function readFolderSettings(root: string): Promise<FolderSettingsFile | null> {
  const parsed = await readJson<FolderSettingsFile>(folderSettingsPath(root))
  if (parsed && parsed.version === 1) return parsed
  return null
}

export async function writeFolderSettings(root: string, settings: FolderSettingsFile): Promise<void> {
  await writeJsonAtomic(folderSettingsPath(root), settings)
}
