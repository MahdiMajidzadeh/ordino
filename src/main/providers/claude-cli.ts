import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import os from 'os'
import { join } from 'path'
import type { TestConnectionResult } from '@shared/types'
import { OrdinoFailure } from '../util/failure'
import { countStreamedMoves } from './json-salvage'
import { buildRepairMessage, buildUserMessage, SYSTEM_PROMPT } from './prompt'
import { detectClaudeCli } from './detect-claude'
import type { ChunkCallContext, ChunkRequest, OrganizerProvider, RepairContext } from './types'

export interface ClaudeCliOptions {
  model: string
  cliPathOverride: string
  /** Optional ANTHROPIC_API_KEY override; default is the CLI's own sign-in. */
  apiKey: string | null
}

/**
 * Built-in tools the headless run must never use: the privacy promise ("file
 * names, never contents") is enforced structurally by denying every tool and
 * pointing cwd at an empty scratch dir — not by politely asking the model.
 */
const DISALLOWED_TOOLS =
  'Bash,Edit,Write,Read,Glob,Grep,WebFetch,WebSearch,NotebookEdit,Task,TodoWrite,BashOutput,KillShell,ExitPlanMode,EnterPlanMode'

const AUTH_ERROR_PATTERN = /log ?in|not authenticated|invalid api key|credit|billing|OAuth|\/login/i

async function scratchCwd(): Promise<string> {
  // Empty dir far away from the user's files AND from any project that might
  // carry Claude settings. userData in Electron; tmpdir in plain node (tests).
  let base: string
  try {
    const { app } = await import('electron')
    base = app.getPath('userData')
  } catch {
    base = os.tmpdir()
  }
  const dir = join(base, 'ordino-claude-scratch')
  await fs.mkdir(dir, { recursive: true })
  return dir
}

interface CliRunResult {
  stdout: string
  stderr: string
  code: number | null
}

function runCli(
  binPath: string,
  args: string[],
  input: string | null,
  opts: {
    cwd: string
    apiKey: string | null
    signal?: AbortSignal
    timeoutMs: number
    onStdoutLine?: (line: string) => void
  }
): Promise<CliRunResult> {
  return new Promise((resolve, reject) => {
    const env = { ...process.env }
    if (opts.apiKey) env.ANTHROPIC_API_KEY = opts.apiKey
    env.CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC = '1'
    // Extended thinking spends minutes producing nothing streamable on large
    // manifests — the UI reads as frozen and the tokens buy little for this
    // structured task. First text tokens arrive almost immediately without it.
    env.MAX_THINKING_TOKENS = '0'

    const child = spawn(binPath, args, {
      cwd: opts.cwd,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
      signal: opts.signal
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      reject(new OrdinoFailure('PROVIDER_TIMEOUT', 'Claude Code took too long to answer', { retryable: true }))
    }, opts.timeoutMs)

    let stdout = ''
    let stderr = ''
    let lineBuffer = ''
    child.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf8')
      stdout += text
      if (opts.onStdoutLine) {
        lineBuffer += text
        let idx: number
        while ((idx = lineBuffer.indexOf('\n')) !== -1) {
          opts.onStdoutLine(lineBuffer.slice(0, idx))
          lineBuffer = lineBuffer.slice(idx + 1)
        }
      }
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8')
    })
    child.on('error', (e) => {
      clearTimeout(timer)
      if ((e as NodeJS.ErrnoException).code === 'ABORT_ERR') reject(e)
      else
        reject(
          new OrdinoFailure('CLAUDE_SPAWN_FAILED', `Could not start Claude Code: ${e.message}`, {
            detail: binPath
          })
        )
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      if (opts.onStdoutLine && lineBuffer.length > 0) opts.onStdoutLine(lineBuffer)
      resolve({ stdout, stderr, code })
    })

    if (input !== null) {
      child.stdin.write(input)
    }
    child.stdin.end()
  })
}

interface StreamJsonLine {
  type?: string
  subtype?: string
  result?: string
  is_error?: boolean
  api_error_status?: number | null
  event?: { type?: string; delta?: { type?: string; text?: string } }
}

export class ClaudeCliProvider implements OrganizerProvider {
  readonly id = 'claude-cli' as const

  private constructor(
    private readonly binPath: string,
    private readonly options: ClaudeCliOptions
  ) {}

  static async create(options: ClaudeCliOptions): Promise<ClaudeCliProvider> {
    const detection = await detectClaudeCli(options.cliPathOverride)
    if (!detection.installed || !detection.path) {
      throw new OrdinoFailure('CLAUDE_NOT_INSTALLED', 'Claude Code is not installed on this machine')
    }
    return new ClaudeCliProvider(detection.path, options)
  }

  /**
   * Headless one-shot run. The prompt travels via stdin (arbitrarily large
   * manifests would blow past OS arg limits). All tools disallowed, empty
   * scratch cwd, user/project settings not loaded, no MCP servers.
   */
  private async runPrompt(
    prompt: string,
    ctx: { signal?: AbortSignal; onText?: (accumulated: string) => void; timeoutMs: number }
  ): Promise<string> {
    // Flag set pinned against Claude Code 2.1.x in the M4 spike. Notes:
    // --max-turns is not supported by the installed CLI (with every tool
    // disallowed the run is single-turn regardless), and --system-prompt
    // REPLACES Claude Code's large default system prompt — Ordino uses no
    // tools, so the default is pure token cost (~27k cached input per call).
    const args = [
      '-p',
      '--output-format', 'stream-json',
      '--include-partial-messages',
      '--verbose',
      '--model', this.options.model,
      '--disallowed-tools', DISALLOWED_TOOLS,
      '--strict-mcp-config',
      '--setting-sources', '',
      '--system-prompt', SYSTEM_PROMPT
    ]

    let accumulated = ''
    let finalResult: string | null = null
    let isError = false
    let apiErrorStatus: number | null = null

    const { stderr, code } = await runCli(this.binPath, args, prompt, {
      cwd: await scratchCwd(),
      apiKey: this.options.apiKey,
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      onStdoutLine: (line) => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('{')) return
        let parsed: StreamJsonLine
        try {
          parsed = JSON.parse(trimmed) as StreamJsonLine
        } catch {
          return
        }
        if (parsed.type === 'stream_event' && parsed.event?.type === 'content_block_delta') {
          const text = parsed.event.delta?.text
          if (text) {
            accumulated += text
            ctx.onText?.(accumulated)
          }
        } else if (parsed.type === 'result') {
          isError = parsed.is_error === true
          if (typeof parsed.api_error_status === 'number') apiErrorStatus = parsed.api_error_status
          if (typeof parsed.result === 'string') finalResult = parsed.result
        }
      }
    })

    if (finalResult !== null && !isError) return finalResult
    const output = finalResult ?? accumulated
    const errorText = `${output}\n${stderr}`.trim()
    // 401 = the CLI's own credentials are bad → sign-in guidance. 403 is
    // usually network/region policy (e.g. reachable only through a proxy
    // that a Dock-launched app didn't inherit) — sign-in advice would
    // mislead, so it surfaces as unreachable WITH the CLI's own words.
    if (apiErrorStatus === 401 || (apiErrorStatus === null && AUTH_ERROR_PATTERN.test(errorText))) {
      throw new OrdinoFailure(
        'CLAUDE_NOT_AUTHENTICATED',
        'Claude Code is not signed in on this machine',
        { detail: errorText.slice(0, 300) }
      )
    }
    if (code !== 0 || isError) {
      throw new OrdinoFailure('PROVIDER_UNREACHABLE', 'Claude Code returned an error', {
        retryable: true,
        detail: errorText.slice(0, 500)
      })
    }
    return accumulated
  }

  async generateChunkPlan(
    req: ChunkRequest,
    ctx: ChunkCallContext,
    repair?: RepairContext
  ): Promise<string> {
    let prompt = buildUserMessage(req)
    if (repair) prompt = `${prompt}\n\n${buildRepairMessage(repair)}`
    return this.runPrompt(prompt, {
      signal: ctx.signal,
      timeoutMs: 300_000,
      onText: (acc) => ctx.onStreamedMoves?.(countStreamedMoves(acc))
    })
  }

  async testConnection(): Promise<TestConnectionResult> {
    const started = performance.now()
    const result = await this.runPrompt('Reply with exactly: OK', { timeoutMs: 90_000 })
    if (!/OK/i.test(result)) {
      throw new OrdinoFailure('PROVIDER_UNREACHABLE', 'Claude Code gave an unexpected reply', {
        retryable: true,
        detail: result.slice(0, 200)
      })
    }
    return { latencyMs: Math.round(performance.now() - started), model: this.options.model }
  }
}
