import { afterEach, describe, expect, it } from 'vitest'
import { applyToFolder } from '@main/apply/engine'
import { undoLastOperation } from '@main/apply/undo'
import { makeTree, removeTree } from './helpers/fixture-fs'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTree))
})

describe('apply performance (§7 target)', () => {
  it('applies 200 moves well under 5s, and undo is symmetric', { timeout: 30_000 }, async () => {
    const spec: Record<string, string> = {}
    for (let i = 0; i < 200; i++) spec[`file-${String(i).padStart(3, '0')}.dat`] = `content-${i}`
    const root = await makeTree(spec)
    roots.push(root)

    const moves = Object.keys(spec).map((name, i) => ({
      source: name,
      destination: `Group ${i % 8}/${name}`
    }))

    const started = performance.now()
    const result = await applyToFolder(
      root,
      { strategy: { id: 'fileType', reuseExistingFolders: true }, moves, trash: [] },
      { osTrash: async () => {} }
    )
    const applyMs = performance.now() - started
    expect(result.moved).toBe(200)
    expect(applyMs).toBeLessThan(5000)

    const undoStarted = performance.now()
    const undo = await undoLastOperation(root)
    expect(undo.restored).toBe(200)
    expect(performance.now() - undoStarted).toBeLessThan(5000)
  })
})
