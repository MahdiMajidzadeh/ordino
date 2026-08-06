/**
 * Path hygiene for AI-proposed plans. All paths are root-relative POSIX; the
 * validator rejects anything that could escape the root or break on any OS.
 */

const WINDOWS_RESERVED = new Set([
  'CON', 'PRN', 'AUX', 'NUL',
  'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
  'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9'
])

/** chars invalid on Windows (superset of mac/linux restrictions), minus '/'. */
const FORBIDDEN_CHARS = /[<>:"\\|?*\u0000-\u001f]/g

export interface NormalizedPath {
  ok: boolean
  /** Normalized root-relative POSIX path ('' = root itself). */
  path: string
  reason?: 'absolute' | 'traversal' | 'empty' | 'reserved-dir'
}

/**
 * Normalize a model-supplied rel path: forward slashes, no './', no empty
 * segments. Rejects absolute paths, drive letters, any '..' segment, and
 * anything targeting Ordino's own state dir.
 */
export function normalizeRelPath(input: string): NormalizedPath {
  let p = input.trim().replaceAll('\\', '/')
  if (p.startsWith('/') || /^[a-zA-Z]:/.test(p) || p.startsWith('~')) {
    return { ok: false, path: input, reason: 'absolute' }
  }
  const segments: string[] = []
  for (const seg of p.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') return { ok: false, path: input, reason: 'traversal' }
    segments.push(seg)
  }
  if (segments.length === 0) return { ok: false, path: input, reason: 'empty' }
  if (segments[0] === '.ordino') return { ok: false, path: input, reason: 'reserved-dir' }
  return { ok: true, path: segments.join('/') }
}

/**
 * Sanitize one proposed folder path segment-by-segment for cross-platform
 * safety. Returns null if nothing survives.
 */
export function sanitizeFolderPath(input: string): { path: string; changed: boolean } | null {
  const normalized = normalizeRelPath(input)
  if (!normalized.ok) return null
  let changed = false
  const segments: string[] = []
  for (const rawSeg of normalized.path.split('/')) {
    let seg = rawSeg.replace(FORBIDDEN_CHARS, '')
    seg = seg.replace(/[. ]+$/g, '') // trailing dots/spaces break Windows
    seg = seg.trim()
    if (WINDOWS_RESERVED.has(seg.toUpperCase())) {
      seg = `${seg}_`
      changed = true
    }
    if (seg !== rawSeg) changed = true
    if (seg.length === 0) {
      changed = true
      continue
    }
    segments.push(seg)
  }
  if (segments.length === 0) return null
  if (segments[0] === '.ordino') return null
  return { path: segments.join('/'), changed }
}

export function baseName(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? relPath : relPath.slice(idx + 1)
}

export function dirName(relPath: string): string {
  const idx = relPath.lastIndexOf('/')
  return idx === -1 ? '' : relPath.slice(0, idx)
}
