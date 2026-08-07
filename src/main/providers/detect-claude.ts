import { promises as fs } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import type { ClaudeDetection } from '@shared/types'
import { captureStdout } from '../util/shell-env'

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

/**
 * Detection must never block the settings screen, so every shell-out here is
 * hard-bounded — see captureStdout for why a plain exec timeout isn't enough.
 */
async function resolveViaShell(): Promise<string | null> {
  if (process.platform === 'win32') {
    const stdout = await captureStdout('where', ['claude'], 5000)
    const first = stdout.split(/\r?\n/).find((l) => l.trim().length > 0)
    return first?.trim() ?? null
  }
  const shell = process.env.SHELL ?? '/bin/zsh'
  const stdout = await captureStdout(shell, ['-l', '-c', 'command -v claude'], 5000)
  const path = stdout.trim().split('\n').pop()?.trim() ?? ''
  return path.startsWith('/') ? path : null
}

async function readVersion(binPath: string): Promise<string | undefined> {
  const stdout = await captureStdout(binPath, ['--version'], 15_000)
  // Typical output: "2.1.0 (Claude Code)"
  const match = stdout.trim().match(/(\d+\.\d+\.\d+)/)
  return match?.[1] ?? (stdout.trim().slice(0, 40) || undefined)
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
