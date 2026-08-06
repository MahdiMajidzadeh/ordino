import { createServer, type Server } from 'http'
import { afterEach, describe, expect, it } from 'vitest'
import { scanFolder } from '@main/scanner/scan'
import { generateRawPlan } from '@main/providers/orchestrator'
import { OpenAiCompatProvider } from '@main/providers/openai-compat'
import { validatePlan } from '@main/plan/validate'
import { detectDuplicates } from '@main/duplicates/detector'
import { makeTree, removeTree } from './helpers/fixture-fs'

/**
 * Full-pipeline test: temp-dir scan → chunked provider call against an
 * in-process "model" (groups by extension, plus one hallucinated move and one
 * rename attempt to prove validation) → assembled, validated Plan.
 */
let server: Server | null = null
let root: string | null = null

afterEach(async () => {
  if (server) await new Promise((r) => server!.close(r))
  server = null
  if (root) await removeTree(root)
  root = null
})

const EXT_FOLDER: Record<string, string> = {
  pdf: 'Documents',
  jpg: 'Images',
  png: 'Images',
  mp3: 'Audio'
}

function startModelStub(): Promise<string> {
  return new Promise((resolve) => {
    server = createServer((req, res) => {
      let body = ''
      req.on('data', (c) => (body += c))
      req.on('end', () => {
        const parsed = JSON.parse(body) as { messages: Array<{ role: string; content: string }> }
        const userMsg = parsed.messages.find((m) => m.role === 'user')!.content
        const manifestSection = userMsg.split('FILES (one JSON object per line):\n')[1].split('\n\n')[0]
        const files = manifestSection
          .split('\n')
          .filter((l) => l.trim().startsWith('{'))
          .map((l) => JSON.parse(l) as { path: string })

        const moves = files
          .map(({ path }) => {
            const ext = path.split('.').pop() ?? ''
            const folder = EXT_FOLDER[ext] ?? 'Other'
            return { source: path, destination: `${folder}/${path.split('/').pop()}`, reason: `is ${ext}` }
          })
          .filter((m) => !m.source.startsWith(`${m.destination.split('/')[0]}/`))

        // Deliberate garbage the validator must handle:
        moves.push({ source: 'hallucinated.bin', destination: 'Ghost/hallucinated.bin', reason: 'x' })
        if (files.length > 0) {
          moves.push({
            source: files[0].path,
            destination: 'Renamed/DIFFERENT-NAME.xyz',
            reason: 'rename attempt'
          })
        }

        const plan = JSON.stringify({ newFolders: ['Documents', 'Images', 'Audio', 'Other'], moves })
        res.writeHead(200, { 'Content-Type': 'text/event-stream' })
        res.end(`data: ${JSON.stringify({ choices: [{ delta: { content: plan } }] })}\n\ndata: [DONE]\n\n`)
      })
    })
    server.listen(0, '127.0.0.1', () => {
      const address = server!.address()
      resolve(`http://127.0.0.1:${(address as { port: number }).port}/v1`)
    })
  })
}

describe('end-to-end plan pipeline', () => {
  it('scan → provider → orchestrator → validated plan on a real folder', async () => {
    root = await makeTree({
      'invoice-march.pdf': 'pdf-a',
      'receipt.pdf': 'pdf-b',
      'IMG_1000.jpg': 'jpg-a',
      'IMG_1001.jpg': 'jpg-a', // duplicate content of IMG_1000
      'song.mp3': 'mp3-a',
      'Existing/already-here.pdf': 'pdf-c',
      '.DS_Store': 'junk'
    })

    const scan = await scanFolder(root, { ignoreGlobs: [] })
    expect(scan.files).toHaveLength(6)

    const baseUrl = await startModelStub()
    const provider = new OpenAiCompatProvider({ baseUrl, model: 'stub' })
    const signal = new AbortController().signal

    const [raw, dupes] = await Promise.all([
      generateRawPlan(
        provider,
        {
          strategy: { id: 'fileType', reuseExistingFolders: true },
          rootName: 'root',
          files: scan.files,
          existingFolders: scan.dirs.map((d) => d.relPath),
          preferredDestinations: []
        },
        signal,
        () => {}
      ),
      detectDuplicates(root, scan.files, {})
    ])

    const validated = validatePlan(raw, {
      validSources: new Set(scan.files.map((f) => f.relPath)),
      existingFolders: new Set(scan.dirs.map((d) => d.relPath))
    })

    // Hallucinated source dropped; rename attempt rewritten (dedupe means the
    // first decision for that file won instead).
    expect(validated.moves.every((m) => m.source !== 'hallucinated.bin')).toBe(true)
    expect(validated.warnings.some((w) => w.code === 'unknown-source-dropped')).toBe(true)

    // Every scanned loose file got a destination inside the root.
    const bySource = new Map(validated.moves.map((m) => [m.source, m]))
    expect(bySource.get('invoice-march.pdf')!.destination).toBe('Documents/invoice-march.pdf')
    expect(bySource.get('song.mp3')!.destination).toBe('Audio/song.mp3')
    expect(validated.newFolders).toEqual(expect.arrayContaining(['Documents', 'Images', 'Audio']))
    expect(validated.newFolders).not.toContain('Existing')

    // Duplicates found locally, keeper has the cleaner original name.
    expect(dupes).toHaveLength(1)
    expect(dupes[0].fileIds.sort()).toEqual(['IMG_1000.jpg', 'IMG_1001.jpg'])
  })
})
