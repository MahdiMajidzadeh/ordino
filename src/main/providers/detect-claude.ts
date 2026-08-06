import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ClaudeDetection } from '@shared/types'

const execFileAsync = promisify(execFile)

/**
 * Find the user's installed Claude Code binary. GUI apps on macOS don't
 * inherit the shell PATH, so we ask a login shell and also probe well-known
 * install locations. A manual override from settings always wins.
 */
const WELL_KNOWN_PATHS: string[] =
  process.platform === 'win32'
    ? [
        join(homedir(), '.claude', 'local', 'claude.exe'),
        join(homedir(), 'AppData', 'Roaming', 'npm', 'claude.cmd')
      ]
    : [
        join(homedir(), '.claude', 'local', 'claude'),
        '/opt/homebrew/bin/claude',
        '/usr/local/bin/claude',
        join(homedir(), '.local', 'bin', 'claude'),
        '/usr/bin/claude'
      ]

async function isExecutable(path: string): Promise<boolean> {
  try {
    await fs.access(path, fs.constants.X_OK)
    const stat = await fs.stat(path)
    return stat.isFile()
  } catch {
    return false
  }
}

async function resolveViaShell(): Promise<string | null> {
  try {
    if (process.platform === 'win32') {
      const { stdout } = await execFileAsync('where', ['claude'], { timeout: 5000 })
      const first = stdout.split(/\r?\n/).find((l) => l.trim().length > 0)
      return first?.trim() ?? null
    }
    const shell = process.env.SHELL ?? '/bin/zsh'
    const { stdout } = await execFileAsync(shell, ['-l', '-c', 'command -v claude'], {
      timeout: 8000
    })
    const path = stdout.trim()
    return path.length > 0 ? path : null
  } catch {
    return null
  }
}

async function readVersion(binPath: string): Promise<string | undefined> {
  try {
    const { stdout } = await execFileAsync(binPath, ['--version'], { timeout: 15_000 })
    // Typical output: "2.1.0 (Claude Code)"
    const match = stdout.trim().match(/(\d+\.\d+\.\d+)/)
    return match?.[1] ?? stdout.trim().slice(0, 40)
  } catch {
    return undefined
  }
}

export async function detectClaudeCli(cliPathOverride?: string): Promise<ClaudeDetection> {
  if (cliPathOverride && cliPathOverride.trim() !== '') {
    const override = cliPathOverride.trim()
    if (await isExecutable(override)) {
      return { installed: true, path: override, version: await readVersion(override), source: 'override' }
    }
    return { installed: false }
  }

  const fromShell = await resolveViaShell()
  if (fromShell && (await isExecutable(fromShell))) {
    return { installed: true, path: fromShell, version: await readVersion(fromShell), source: 'path' }
  }

  for (const candidate of WELL_KNOWN_PATHS) {
    if (await isExecutable(candidate)) {
      return {
        installed: true,
        path: candidate,
        version: await readVersion(candidate),
        source: 'well-known'
      }
    }
  }

  return { installed: false }
}
