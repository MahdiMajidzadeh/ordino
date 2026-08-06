import { promises as fs } from 'fs'
import { dirname, join } from 'path'

/**
 * Resolve a destination-name collision by suffixing "name (1).ext",
 * "name (2).ext"… (P0-6). Existence checks are effectively case-insensitive
 * on macOS/Windows because fs.access follows the volume's semantics.
 */
export async function resolveCollision(absDestination: string): Promise<{
  finalAbs: string
  collided: boolean
}> {
  if (!(await exists(absDestination))) return { finalAbs: absDestination, collided: false }

  const dir = dirname(absDestination)
  const base = absDestination.slice(dir.length + 1)
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const ext = dot > 0 ? base.slice(dot) : ''

  for (let n = 1; n < 1000; n++) {
    const candidate = join(dir, `${stem} (${n})${ext}`)
    if (!(await exists(candidate))) return { finalAbs: candidate, collided: true }
  }
  throw new Error(`Could not find a free name for ${absDestination}`)
}

async function exists(p: string): Promise<boolean> {
  try {
    await fs.access(p)
    return true
  } catch {
    return false
  }
}
