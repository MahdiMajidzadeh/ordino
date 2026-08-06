import type { InclusionChoice } from './types'

/** Ancestor dir paths of a rel path, nearest first: 'a/b/c' → ['a/b', 'a']. */
export function ancestorDirs(relPath: string): string[] {
  const out: string[] = []
  let idx = relPath.lastIndexOf('/')
  while (idx > 0) {
    out.push(relPath.slice(0, idx))
    idx = relPath.lastIndexOf('/', idx - 1)
  }
  return out
}

/**
 * Subfolder inclusion semantics (P0-2), shared by renderer (checkbox UI) and
 * main (building the AI manifest): only explicit choices are stored;
 * everything else inherits from the nearest explicitly-chosen ancestor and
 * defaults to include.
 */
export function effectiveChoice(
  dirPath: string,
  explicit: Readonly<Record<string, InclusionChoice>>
): InclusionChoice {
  const own = explicit[dirPath]
  if (own) return own
  for (const ancestor of ancestorDirs(dirPath)) {
    const choice = explicit[ancestor]
    if (choice) return choice
  }
  return 'include'
}

export function fileIsIncluded(
  file: { parentDir: string },
  explicit: Readonly<Record<string, InclusionChoice>>
): boolean {
  if (file.parentDir === '') return true
  return effectiveChoice(file.parentDir, explicit) === 'include'
}
