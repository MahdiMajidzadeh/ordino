import type { InclusionChoice, ScanDir, ScanFile } from '@shared/types'
import { effectiveChoice, fileIsIncluded } from '@shared/inclusion'

export type CheckState = 'checked' | 'unchecked' | 'indeterminate'

// Core inclusion semantics live in @shared/inclusion (main uses them too when
// building the AI manifest); this module adds the checkbox-UI helpers.
export { effectiveChoice, fileIsIncluded }

/**
 * Checkbox state for a dir row: skip → unchecked; include with any skipped
 * descendant → indeterminate; otherwise checked.
 */
export function checkStateOf(
  dirPath: string,
  dirs: readonly ScanDir[],
  explicit: Readonly<Record<string, InclusionChoice>>
): CheckState {
  if (effectiveChoice(dirPath, explicit) === 'skip') return 'unchecked'
  const prefix = `${dirPath}/`
  for (const d of dirs) {
    if (d.relPath.startsWith(prefix) && effectiveChoice(d.relPath, explicit) === 'skip') {
      return 'indeterminate'
    }
  }
  return 'checked'
}

/**
 * Toggling a dir sets it explicitly and clears explicit choices beneath it
 * (a fresh cascade), returning a new record.
 */
export function toggleDir(
  dirPath: string,
  next: boolean,
  explicit: Readonly<Record<string, InclusionChoice>>
): Record<string, InclusionChoice> {
  const prefix = `${dirPath}/`
  const out: Record<string, InclusionChoice> = {}
  for (const [key, value] of Object.entries(explicit)) {
    if (key !== dirPath && !key.startsWith(prefix)) out[key] = value
  }
  out[dirPath] = next ? 'include' : 'skip'
  return out
}

export function setAll(
  dirs: readonly ScanDir[],
  choice: InclusionChoice
): Record<string, InclusionChoice> {
  const out: Record<string, InclusionChoice> = {}
  for (const d of dirs) {
    if (d.parentDir === '' || d.parentDir === null) out[d.relPath] = choice
  }
  return out
}

export function countIncludedFiles(
  files: readonly Pick<ScanFile, 'parentDir'>[],
  explicit: Readonly<Record<string, InclusionChoice>>
): number {
  let count = 0
  for (const f of files) if (fileIsIncluded(f, explicit)) count += 1
  return count
}
