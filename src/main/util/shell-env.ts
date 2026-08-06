import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * GUI-launched apps on macOS/Linux get launchd's minimal environment — no
 * shell PATH additions and, critically, no proxy variables (HTTP_PROXY /
 * HTTPS_PROXY / NO_PROXY). Users behind an env-var proxy can reach Anthropic
 * from a terminal but not from a Finder-launched Ordino. This captures the
 * login+interactive shell environment once and fills the gaps.
 */
let cached: Record<string, string> | null = null

export function parseEnvNul(output: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const entry of output.split('\0')) {
    if (!entry) continue
    const eq = entry.indexOf('=')
    if (eq <= 0) continue
    env[entry.slice(0, eq)] = entry.slice(eq + 1)
  }
  return env
}

export async function getLoginShellEnv(): Promise<Record<string, string>> {
  if (cached) return cached
  if (process.platform === 'win32') {
    cached = {}
    return cached
  }
  const shell = process.env.SHELL ?? '/bin/zsh'
  try {
    // -l -i: login + interactive, because proxy exports commonly live in
    // .zshrc/.bashrc. `command env -0` survives values containing newlines.
    const { stdout } = await execFileAsync(shell, ['-l', '-i', '-c', 'command env -0'], {
      timeout: 8000,
      maxBuffer: 1024 * 1024,
      encoding: 'utf8'
    })
    cached = parseEnvNul(stdout)
  } catch {
    try {
      // Some shells misbehave with -i non-tty; login-only second chance.
      const { stdout } = await execFileAsync(shell, ['-l', '-c', 'command env -0'], {
        timeout: 8000,
        maxBuffer: 1024 * 1024,
        encoding: 'utf8'
      })
      cached = parseEnvNul(stdout)
    } catch {
      cached = {}
    }
  }
  return cached
}

/**
 * Fill process.env gaps from the login shell: existing values win (a
 * terminal-launched dev run keeps its exact env), missing keys are adopted,
 * and PATH becomes the union with shell entries appended.
 */
export async function hydrateProcessEnv(): Promise<void> {
  const shellEnv = await getLoginShellEnv()
  for (const [key, value] of Object.entries(shellEnv)) {
    if (key === 'PATH') continue
    if (process.env[key] === undefined) process.env[key] = value
  }
  const shellPath = shellEnv.PATH
  if (shellPath) {
    const current = (process.env.PATH ?? '').split(':').filter(Boolean)
    const merged = [...current]
    for (const dir of shellPath.split(':')) {
      if (dir && !merged.includes(dir)) merged.push(dir)
    }
    process.env.PATH = merged.join(':')
  }
}
