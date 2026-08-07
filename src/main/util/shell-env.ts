import { spawn } from 'child_process'

/**
 * GUI-launched apps on macOS/Linux get launchd's minimal environment — no
 * shell PATH additions and, critically, no proxy variables (HTTP_PROXY /
 * HTTPS_PROXY / NO_PROXY). Users behind an env-var proxy can reach Anthropic
 * from a terminal but not from a Finder-launched Ordino. This captures the
 * login+interactive shell environment once and fills the gaps.
 */
let cached: Record<string, string> | null = null

/**
 * Run a command and return its stdout, giving up after `timeoutMs` no matter
 * what. Never rejects.
 *
 * child_process.exec resolves when stdout *closes*, not when the child exits,
 * and its `timeout` option doesn't change that — so a shell whose rc files
 * start a background job that inherits stdout hangs forever. An interactive
 * shell can also block reading stdin. Both were observed hanging for fifteen
 * minutes, and this runs during startup, so the bound has to be absolute:
 * stdin is closed, stderr is discarded, and a timer kills the process and
 * resolves regardless.
 */
export function captureStdout(
  command: string,
  args: readonly string[],
  timeoutMs: number
): Promise<string> {
  return new Promise((resolve) => {
    let out = ''
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(hardStop)
      clearTimeout(exitGrace)
      resolve(out)
    }

    let child: ReturnType<typeof spawn>
    try {
      child = spawn(command, [...args], {
        stdio: ['ignore', 'pipe', 'ignore'],
        detached: false
      })
    } catch {
      resolve('')
      return
    }

    const hardStop = setTimeout(() => {
      try {
        child.kill('SIGKILL')
      } catch {
        /* already gone */
      }
      finish()
    }, timeoutMs)

    let exitGrace: NodeJS.Timeout
    child.stdout?.on('data', (chunk: Buffer) => {
      out += chunk.toString('utf8')
    })
    child.on('error', finish)
    // 'close' waits for stdio to drain, which a lingering grandchild can hold
    // open; 'exit' fires as soon as the shell itself is done, so treat that as
    // the answer after a short flush window.
    child.on('exit', () => {
      exitGrace = setTimeout(finish, 150)
    })
    child.on('close', finish)
  })
}

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
  // -l -i: login + interactive, because proxy exports commonly live in
  // .zshrc/.bashrc rather than the login-only files. `command env -0`
  // survives values containing newlines.
  let stdout = await captureStdout(shell, ['-l', '-i', '-c', 'command env -0'], 5000)
  if (!stdout.includes('\0')) {
    // Some shells refuse -i without a tty; login-only second chance.
    stdout = await captureStdout(shell, ['-l', '-c', 'command env -0'], 5000)
  }
  cached = parseEnvNul(stdout)
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
