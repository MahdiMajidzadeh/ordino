import type { ModelListResult, TestConnectionResult } from '@shared/types'
import { OrdinoFailure } from '../util/failure'
import { countStreamedMoves } from './json-salvage'
import { buildRepairMessage, buildUserMessage, SYSTEM_PROMPT } from './prompt'
import type { ChunkCallContext, ChunkRequest, OrganizerProvider, RepairContext } from './types'

export interface OpenAiCompatOptions {
  baseUrl: string
  model: string
  apiKey?: string | null
  /** Per-call timeout; generous because local models can be slow. */
  timeoutMs?: number
}

/** Endpoints that rejected response_format this session (probed once). */
const jsonModeUnsupported = new Set<string>()

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/, '')
}

function headers(apiKey?: string | null): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' }
  if (apiKey && apiKey.trim() !== '') h.Authorization = `Bearer ${apiKey.trim()}`
  return h
}

function mapNetworkError(e: unknown, baseUrl: string): OrdinoFailure {
  if (e instanceof OrdinoFailure) return e
  const message = e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e)
  if (e instanceof Error && e.name === 'TimeoutError') {
    return new OrdinoFailure('PROVIDER_TIMEOUT', 'The endpoint took too long to answer', {
      retryable: true
    })
  }
  if (/ECONNREFUSED|ENOTFOUND|EAI_AGAIN|fetch failed/i.test(message)) {
    return new OrdinoFailure('PROVIDER_UNREACHABLE', `Nothing is answering at ${baseUrl}`, {
      retryable: true,
      detail: message
    })
  }
  return new OrdinoFailure('PROVIDER_UNREACHABLE', message, { retryable: true })
}

function mapHttpStatus(status: number, body: string, baseUrl: string): OrdinoFailure {
  if (status === 401 || status === 403) {
    return new OrdinoFailure('PROVIDER_AUTH_FAILED', 'The API key was rejected', { detail: body.slice(0, 300) })
  }
  if (status === 404) {
    return new OrdinoFailure(
      'PROVIDER_BAD_ENDPOINT',
      `${baseUrl} does not look like an OpenAI-compatible endpoint`,
      { detail: body.slice(0, 300) }
    )
  }
  if (status === 429 || status >= 500) {
    return new OrdinoFailure('PROVIDER_UNREACHABLE', `The endpoint returned HTTP ${status}`, {
      retryable: true,
      detail: body.slice(0, 300)
    })
  }
  return new OrdinoFailure('PROVIDER_BAD_ENDPOINT', `The endpoint returned HTTP ${status}`, {
    detail: body.slice(0, 300)
  })
}

/** Parse an SSE chat-completions stream, invoking onDelta per content token. */
async function consumeSse(
  res: Response,
  onDelta: (contentDelta: string) => void
): Promise<void> {
  const reader = res.body!.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    let idx: number
    while ((idx = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, idx).trim()
      buffer = buffer.slice(idx + 1)
      if (!line.startsWith('data:')) continue
      const payload = line.slice(5).trim()
      if (payload === '[DONE]') return
      try {
        const parsed = JSON.parse(payload) as {
          choices?: Array<{ delta?: { content?: string } }>
        }
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) onDelta(delta)
      } catch {
        // keep-alive or vendor extension line — ignore
      }
    }
  }
}

export class OpenAiCompatProvider implements OrganizerProvider {
  readonly id = 'openai-compat' as const

  constructor(private readonly options: OpenAiCompatOptions) {
    if (!options.baseUrl.trim()) {
      throw new OrdinoFailure('PROVIDER_NOT_CONFIGURED', 'No base URL configured')
    }
    if (!options.model.trim()) {
      throw new OrdinoFailure('PROVIDER_NOT_CONFIGURED', 'No model configured')
    }
  }

  async generateChunkPlan(
    req: ChunkRequest,
    ctx: ChunkCallContext,
    repair?: RepairContext
  ): Promise<string> {
    const base = normalizeBaseUrl(this.options.baseUrl)
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(req) }
    ]
    if (repair) {
      messages.push(
        { role: 'assistant', content: repair.previousOutput.slice(0, 8000) },
        { role: 'user', content: buildRepairMessage(repair) }
      )
    }

    const attempt = async (useJsonMode: boolean): Promise<string> => {
      const body: Record<string, unknown> = {
        model: this.options.model,
        messages,
        temperature: 0.2,
        stream: true
      }
      if (useJsonMode) body.response_format = { type: 'json_object' }

      let res: Response
      try {
        res = await fetch(`${base}/chat/completions`, {
          method: 'POST',
          headers: headers(this.options.apiKey),
          body: JSON.stringify(body),
          signal: AbortSignal.any([
            ctx.signal,
            AbortSignal.timeout(this.options.timeoutMs ?? 180_000)
          ])
        })
      } catch (e) {
        if (ctx.signal.aborted) throw e
        throw mapNetworkError(e, base)
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        // Some local servers 400 on response_format — retry once without it
        // and remember the capability for this base URL.
        if (useJsonMode && res.status === 400 && /response_format|json_object/i.test(text)) {
          jsonModeUnsupported.add(base)
          return attempt(false)
        }
        throw mapHttpStatus(res.status, text, base)
      }

      let full = ''
      await consumeSse(res, (delta) => {
        full += delta
        ctx.onStreamedMoves?.(countStreamedMoves(full))
      })
      return full
    }

    return attempt(!jsonModeUnsupported.has(base))
  }

  async listModels(signal?: AbortSignal): Promise<ModelListResult> {
    const base = normalizeBaseUrl(this.options.baseUrl)
    try {
      const res = await fetch(`${base}/models`, {
        headers: headers(this.options.apiKey),
        signal: AbortSignal.any([signal ?? new AbortController().signal, AbortSignal.timeout(15_000)])
      })
      if (!res.ok) throw mapHttpStatus(res.status, await res.text().catch(() => ''), base)
      const data = (await res.json()) as { data?: Array<{ id?: string }> }
      const models = (data.data ?? [])
        .map((m) => m.id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0)
        .sort()
      return { models, source: 'endpoint' }
    } catch (e) {
      throw e instanceof OrdinoFailure ? e : mapNetworkError(e, base)
    }
  }

  async testConnection(signal?: AbortSignal): Promise<TestConnectionResult> {
    const started = performance.now()
    try {
      const { models } = await this.listModels(signal)
      // /models answered — good enough to call it connected.
      const known = models.includes(this.options.model)
      return {
        latencyMs: Math.round(performance.now() - started),
        model: known ? this.options.model : (models[0] ?? this.options.model)
      }
    } catch (e) {
      // Endpoints without /models (rare): fall back to a 1-token completion.
      if (e instanceof OrdinoFailure && e.code === 'PROVIDER_BAD_ENDPOINT') {
        const base = normalizeBaseUrl(this.options.baseUrl)
        let res: Response
        try {
          res = await fetch(`${base}/chat/completions`, {
            method: 'POST',
            headers: headers(this.options.apiKey),
            body: JSON.stringify({
              model: this.options.model,
              messages: [{ role: 'user', content: 'ping' }],
              max_tokens: 1
            }),
            signal: AbortSignal.timeout(20_000)
          })
        } catch (err) {
          throw mapNetworkError(err, base)
        }
        if (!res.ok) throw mapHttpStatus(res.status, await res.text().catch(() => ''), base)
        return { latencyMs: Math.round(performance.now() - started), model: this.options.model }
      }
      throw e
    }
  }
}
