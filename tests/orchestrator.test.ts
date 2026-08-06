import { describe, expect, it } from 'vitest'
import type { ScanFile } from '@shared/types'
import { generateRawPlan, type OrchestratorProgress } from '@main/providers/orchestrator'
import type { ChunkCallContext, ChunkRequest, OrganizerProvider, RepairContext } from '@main/providers/types'
import { OrdinoFailure } from '@main/util/failure'

function file(relPath: string, ext = 'txt'): ScanFile {
  return {
    id: relPath,
    relPath,
    name: relPath.split('/').pop()!,
    ext,
    size: 100,
    createdAt: Date.UTC(2026, 0, 1),
    modifiedAt: Date.UTC(2026, 0, 2),
    parentDir: '',
    isSymlink: false
  }
}

function makeFiles(n: number): ScanFile[] {
  return Array.from({ length: n }, (_, i) => file(`f${String(i).padStart(4, '0')}.dat`, 'dat'))
}

class ScriptedProvider implements OrganizerProvider {
  readonly id = 'openai-compat' as const
  calls: Array<{ req: ChunkRequest; repair?: RepairContext }> = []
  constructor(private readonly script: (call: number, req: ChunkRequest, repair?: RepairContext) => string) {}

  async generateChunkPlan(req: ChunkRequest, _ctx: ChunkCallContext, repair?: RepairContext): Promise<string> {
    this.calls.push({ req, repair })
    return this.script(this.calls.length, req, repair)
  }
}

const signal = new AbortController().signal
const input = (files: ScanFile[]): Parameters<typeof generateRawPlan>[1] => ({
  strategy: { id: 'smart', reuseExistingFolders: true },
  rootName: 'Test',
  files,
  existingFolders: [],
  preferredDestinations: []
})

describe('generateRawPlan', () => {
  it('single call under the single-call limit', async () => {
    const provider = new ScriptedProvider(() =>
      JSON.stringify({ newFolders: ['A'], moves: [{ source: 'f0000.dat', destination: 'A/f0000.dat', reason: 'r' }] })
    )
    const plan = await generateRawPlan(provider, input(makeFiles(100)), signal, () => {})
    expect(provider.calls).toHaveLength(1)
    expect(plan.moves).toHaveLength(1)
  })

  it('chunks above the single-call limit and threads decided folders into later chunks', async () => {
    const provider = new ScriptedProvider((call) =>
      JSON.stringify({
        newFolders: [`Folder${call}`],
        moves: [{ source: `f000${call - 1}.dat`, destination: `Folder${call}/f000${call - 1}.dat`, reason: '' }]
      })
    )
    const progress: OrchestratorProgress[] = []
    const plan = await generateRawPlan(provider, input(makeFiles(450)), signal, (p) => progress.push(p))

    expect(provider.calls).toHaveLength(3) // 450 → 150+150+150
    expect(provider.calls[0].req.priorDecidedFolders).toEqual([])
    expect(provider.calls[1].req.priorDecidedFolders).toContain('Folder1')
    expect(provider.calls[2].req.priorDecidedFolders).toEqual(expect.arrayContaining(['Folder1', 'Folder2']))
    expect(plan.newFolders).toEqual(['Folder1', 'Folder2', 'Folder3'])
    expect(progress.at(-1)).toMatchObject({ filesAnalyzed: 450, filesTotal: 450, chunk: { current: 3, total: 3 } })
  })

  it('salvages fenced/prose-wrapped JSON without a repair call', async () => {
    const provider = new ScriptedProvider(
      () => 'Here is the plan:\n```json\n{"newFolders": [], "moves": []}\n```\nHope this helps!'
    )
    const plan = await generateRawPlan(provider, input(makeFiles(3)), signal, () => {})
    expect(provider.calls).toHaveLength(1)
    expect(plan.moves).toEqual([])
  })

  it('repairs once on malformed output, feeding errors back', async () => {
    const provider = new ScriptedProvider((call, _req, repair) => {
      if (call === 1) return 'not json at all'
      expect(repair).toBeDefined()
      expect(repair!.errors.length).toBeGreaterThan(0)
      return JSON.stringify({ newFolders: [], moves: [] })
    })
    const plan = await generateRawPlan(provider, input(makeFiles(3)), signal, () => {})
    expect(provider.calls).toHaveLength(2)
    expect(plan.moves).toEqual([])
  })

  it('fails retryable PLAN_MALFORMED after two bad outputs', async () => {
    const provider = new ScriptedProvider(() => '{"moves": "this is not an array"}')
    await expect(generateRawPlan(provider, input(makeFiles(3)), signal, () => {})).rejects.toSatisfy(
      (e: unknown) =>
        e instanceof OrdinoFailure && e.code === 'PLAN_MALFORMED' && e.retryable === true
    )
    expect(provider.calls).toHaveLength(2)
  })

  it('passes preferred destinations through and excludes them from priorDecided', async () => {
    const provider = new ScriptedProvider(() => JSON.stringify({ newFolders: [], moves: [] }))
    await generateRawPlan(
      provider,
      { ...input(makeFiles(300)), preferredDestinations: ['Invoices'] },
      signal,
      () => {}
    )
    expect(provider.calls[0].req.preferredDestinations).toEqual(['Invoices'])
    expect(provider.calls[1].req.priorDecidedFolders).not.toContain('Invoices')
  })
})
