/**
 * Names that never take part in scanning or planning (P0-1). Dotfiles are
 * excluded wholesale; the OS/system list catches the non-dot offenders.
 */
const SYSTEM_ENTRY_NAMES = new Set(['Thumbs.db', 'desktop.ini', '$RECYCLE.BIN', 'System Volume Information'])

/** Ordino's own per-folder state — invisible to every scan and plan. */
export const ORDINO_STATE_DIR = '.ordino'

export function isHiddenOrSystemEntry(name: string): boolean {
  if (name.startsWith('.')) return true // covers .DS_Store, .git, .ordino, dotfiles
  if (SYSTEM_ENTRY_NAMES.has(name)) return true
  if (name === 'Icon\r') return true // macOS custom-icon carrier
  if (name.startsWith('~$')) return true // MS Office lock files
  return false
}
