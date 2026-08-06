import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http'
import { afterEach, describe, expect, it } from 'vitest'
import { OpenAiCompatProvider } from '@main/providers/openai-compat'
import type { ChunkRequest } from '@main/providers/types'
import { OrdinoFailure } from '@main/util/failure'

let server: Server | null = null

async function startStub(
  handler: (req: IncomingMessage, res: ServerResponse, body: string) => void
): Promise<string> {
  server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => handler(req, res, body))
  })
  await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve))
  const address = server!.address()
  if (typeof address === 'string' || !address) throw new Error('no port')
  return `http://127.0.0.1:${address.port}/v1`
}

afterEach(async () => {
  if (server) {
    await new Promise((resolve) => server!.close(resolve))
    server = null
  }
})

function sseBody(content: string): string {
  const chunks = content.match(/.{1,20}/gs) ?? []
  return (
    chunks
      .map((c) => `data: ${JSON.stringify({ choices: [{ delta: { content: c } }] })}\n\n`)
      .join('') + 'data: [DONE]\n\n'
  )
}

const chunkReq: ChunkRequest = {
  strategy: { id: 'smart', reuseExistingFolders: true },
  rootName: 'Test',
  files: [
    {
      relPath: 'a.pdf',
      name: 'a.pdf',
      ext: 'pdf',
      size: 1000,
      createdAt: '2026-01-01',
      modifiedAt: '2026-01-02'
    }
  ],
  existingFolders: [],
  preferredDestinations: [],
  priorDecidedFolders: []
}

const ctx = { signal: new AbortController().signal }

describe('OpenAiCompatProvider', () => {
  it('streams a chat completion and returns the full text', async () => {
    const plan = '{"newFolders":["Docs"],"moves":[{"source":"a.pdf","destination":"Docs/a.pdf","reason":"r"}]}'
    const base = await startStub((req, res, body) => {
      expect(req.url).toBe('/v1/chat/completions')
      const parsed = JSON.parse(body)
      expect(parsed.response_format).toEqual({ type: 'json_object' })
      expect(parsed.messages[0].role).toBe('system')
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(sseBody(plan))
    })
    const provider = new OpenAiCompatProvider({ baseUrl: base, model: 'test-model' })
    const result = await provider.generateChunkPlan(chunkReq, ctx)
    expect(result).toBe(plan)
  })

  it('reports streamed move counts as progress', async () => {
    const plan =
      '{"newFolders":[],"moves":[{"source":"a.pdf","destination":"X/a.pdf","reason":""},{"source":"b.pdf","destination":"X/b.pdf","reason":""}]}'
    const base = await startStub((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(sseBody(plan))
    })
    const provider = new OpenAiCompatProvider({ baseUrl: base, model: 'm' })
    const counts: number[] = []
    await provider.generateChunkPlan(chunkReq, { ...ctx, onStreamedMoves: (n) => counts.push(n) })
    expect(counts.at(-1)).toBe(2)
  })

  it('retries without response_format when the endpoint rejects it', async () => {
    let calls = 0
    const base = await startStub((_req, res, body) => {
      calls += 1
      const parsed = JSON.parse(body)
      if (parsed.response_format) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: { message: "'response_format' is not supported" } }))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' })
      res.end(sseBody('{"newFolders":[],"moves":[]}'))
    })
    const provider = new OpenAiCompatProvider({ baseUrl: base, model: 'm' })
    const result = await provider.generateChunkPlan(chunkReq, ctx)
    expect(calls).toBe(2)
    expect(result).toBe('{"newFolders":[],"moves":[]}')
  })

  it('maps 401 to PROVIDER_AUTH_FAILED', async () => {
    const base = await startStub((_req, res) => {
      res.writeHead(401)
      res.end('{"error":"bad key"}')
    })
    const provider = new OpenAiCompatProvider({ baseUrl: base, model: 'm', apiKey: 'wrong' })
    await expect(provider.generateChunkPlan(chunkReq, ctx)).rejects.toSatisfy(
      (e: unknown) => e instanceof OrdinoFailure && e.code === 'PROVIDER_AUTH_FAILED'
    )
  })

  it('maps connection-refused to retryable PROVIDER_UNREACHABLE', async () => {
    const provider = new OpenAiCompatProvider({ baseUrl: 'http://127.0.0.1:9', model: 'm' })
    await expect(provider.generateChunkPlan(chunkReq, ctx)).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof OrdinoFailure && e.code === 'PROVIDER_UNREACHABLE' && e.retryable === true
    )
  })

  it('lists models from /models, sorted', async () => {
    const base = await startStub((req, res) => {
      expect(req.url).toBe('/v1/models')
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'zeta' }, { id: 'alpha' }] }))
    })
    const provider = new OpenAiCompatProvider({ baseUrl: base, model: 'm' })
    expect(await provider.listModels()).toEqual({ models: ['alpha', 'zeta'], source: 'endpoint' })
  })

  it('omits the Authorization header when no key is set (Ollama)', async () => {
    const base = await startStub((req, res) => {
      expect(req.headers.authorization).toBeUndefined()
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [] }))
    })
    const provider = new OpenAiCompatProvider({ baseUrl: base, model: 'm' })
    await provider.listModels()
  })

  it('testConnection succeeds via /models', async () => {
    const base = await startStub((_req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ data: [{ id: 'llama3.2' }] }))
    })
    const provider = new OpenAiCompatProvider({ baseUrl: base, model: 'llama3.2' })
    const result = await provider.testConnection()
    expect(result.model).toBe('llama3.2')
    expect(result.latencyMs).toBeGreaterThanOrEqual(0)
  })
})
