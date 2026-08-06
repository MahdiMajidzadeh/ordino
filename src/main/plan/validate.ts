import type { RawPlan } from '@shared/plan-schema'
import type { PlanMove, PlanWarning } from '@shared/types'
import { baseName, dirName, normalizeRelPath, sanitizeFolderPath } from './normalize'

export interface ValidationContext {
  /** Files eligible to move this run (the organize set), by rel path. */
  validSources: ReadonlySet<string>
  /** Folders that already exist on disk (included + skipped-by-reference). */
  existingFolders: ReadonlySet<string>
}

export interface ValidatedPlan {
  moves: PlanMove[]
  newFolders: string[]
  warnings: PlanWarning[]
}

/**
 * Semantic validation of an assembled raw plan (P0-4): hallucinated sources
 * dropped, destinations normalized/sanitized and confined to the root,
 * renames rewritten away (v1 non-goal enforced structurally), one move per
 * source, no-op moves dropped. Also re-run at apply time on renderer-edited
 * plans — main never trusts the renderer.
 */
export function validatePlan(raw: RawPlan, ctx: ValidationContext): ValidatedPlan {
  const moves: PlanMove[] = []
  const warnings: PlanWarning[] = []
  const seenSources = new Set<string>()
  const referencedFolders = new Set<string>()

  for (const move of raw.moves) {
    const source = normalizeRelPath(move.source)
    if (!source.ok || !ctx.validSources.has(source.path)) {
      warnings.push({
        code: 'unknown-source-dropped',
        detail: move.source
      })
      continue
    }
    if (seenSources.has(source.path)) continue // first decision wins
    const sourceBase = baseName(source.path)

    // Destination: accept either a folder path or a full file path; the
    // basename is always forced back to the source's (no renames in v1).
    const destInput = normalizeRelPath(move.destination)
    if (!destInput.ok) {
      warnings.push({ code: 'unknown-source-dropped', detail: `${move.source} → ${move.destination}` })
      continue
    }
    let destFolderRaw =
      baseName(destInput.path) === sourceBase ? dirName(destInput.path) : destInput.path
    if (baseName(destInput.path) !== sourceBase && destInput.path.includes('.') && dirName(destInput.path) !== '') {
      // Looked like a file path with a different name — treat its dir as the
      // destination and note the rewrite.
      const looksLikeFile = /\.[A-Za-z0-9]{1,8}$/.test(destInput.path)
      if (looksLikeFile) {
        destFolderRaw = dirName(destInput.path)
        warnings.push({ code: 'destination-rewritten', detail: `${move.destination} → ${destFolderRaw}/${sourceBase}` })
      }
    }

    let destFolder = ''
    if (destFolderRaw !== '') {
      const sanitized = sanitizeFolderPath(destFolderRaw)
      if (!sanitized) {
        warnings.push({ code: 'unknown-source-dropped', detail: `${move.source} → ${move.destination}` })
        continue
      }
      if (sanitized.changed) {
        warnings.push({ code: 'folder-name-sanitized', detail: `${destFolderRaw} → ${sanitized.path}` })
      }
      destFolder = sanitized.path
    }

    const destination = destFolder === '' ? sourceBase : `${destFolder}/${sourceBase}`
    if (destination === source.path) continue // no-op

    seenSources.add(source.path)
    referencedFolders.add(destFolder)
    moves.push({
      fileId: source.path,
      source: source.path,
      destination,
      destFolder,
      reason: move.reason.trim()
    })
  }

  // newFolders = (declared ∪ referenced) − existing, sanitized, with parents.
  const folderSet = new Set<string>()
  for (const declared of raw.newFolders) {
    const sanitized = sanitizeFolderPath(declared)
    if (sanitized) folderSet.add(sanitized.path)
  }
  for (const referenced of referencedFolders) {
    if (referenced !== '') folderSet.add(referenced)
  }
  const withParents = new Set<string>()
  for (const folder of folderSet) {
    const segments = folder.split('/')
    for (let i = 1; i <= segments.length; i++) {
      withParents.add(segments.slice(0, i).join('/'))
    }
  }
  const newFolders = [...withParents]
    .filter((f) => !ctx.existingFolders.has(f))
    // Only keep folders that actually receive something or whose declared
    // subtree receives something — a bare declared folder with no moves is
    // noise, except when it parents a receiving folder.
    .filter((f) => {
      for (const referenced of referencedFolders) {
        if (referenced === f || referenced.startsWith(`${f}/`)) return true
      }
      return false
    })
    .sort()

  return { moves, newFolders, warnings }
}
