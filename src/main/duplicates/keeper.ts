import type { KeeperReasonCode, ScanFile } from '@shared/types'

const COPY_MARKERS = [/\(\d+\)\s*$/, /\bcopy(?:\s+\d+)?$/i, /^copy of /i, /\s\d$/]

function hasCopyMarker(name: string): boolean {
  const dot = name.lastIndexOf('.')
  const stem = dot > 0 ? name.slice(0, dot) : name
  return COPY_MARKERS.some((re) => re.test(stem.trim()))
}

/**
 * Pick the copy to keep (P0-8). First match wins:
 *  1. already at an organized destination (per the folder manifest)
 *  2. the copy whose name lacks copy-markers ("(1)", "copy", trailing digit)
 *  3. earliest createdAt (likely the original)
 *  4. shortest relPath
 */
export function pickKeeper(
  group: readonly ScanFile[],
  organizedIds: ReadonlySet<string>
): { keeperId: string; reasonCode: KeeperReasonCode } {
  const organized = group.filter((f) => organizedIds.has(f.id))
  if (organized.length > 0) return { keeperId: organized[0].id, reasonCode: 'organized' }

  const clean = group.filter((f) => !hasCopyMarker(f.name))
  if (clean.length > 0 && clean.length < group.length) {
    return { keeperId: clean[0].id, reasonCode: 'clean-name' }
  }

  const byAge = [...group].sort((a, b) => a.createdAt - b.createdAt)
  if (byAge[0].createdAt !== byAge[byAge.length - 1].createdAt) {
    return { keeperId: byAge[0].id, reasonCode: 'oldest' }
  }

  const byPath = [...group].sort((a, b) => a.relPath.length - b.relPath.length)
  return { keeperId: byPath[0].id, reasonCode: 'shortest-path' }
}
