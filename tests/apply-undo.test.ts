import { promises as fs } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyToFolder, type ApplyEngineOptions } from '@main/apply/engine'
import { undoAvailability, undoLastOperation } from '@main/apply/undo'
import { readJournal, readManifest, writeJournal } from '@main/folder-state/store'
import { resolveCollision } from '@main/apply/collisions'
import { OrdinoFailure } from '@main/util/failure'
import { makeTree, removeTree, snapshotFiles } from './helpers/fixture-fs'

const roots: string[] = []
async function tree(spec: Record<string, string | null>): Promise<string> {
  const root = await makeTree(spec)
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTree))
})

const STRATEGY = { id: 'smart' as const, reuseExistingFolders: true }

/** Test double for shell.trashItem: moves into an out-of-root graveyard. */
function makeOsTrash(): { osTrash: ApplyEngineOptions['osTrash']; trashed: string[] } {
  const trashed: string[] = []
  return {
    trashed,
    osTrash: async (absPath: string) => {
      await fs.access(absPath)
      await fs.rm(absPath, { force: true }) // simulate leaving the folder
      trashed.push(absPath)
    }
  }
}

describe('applyToFolder', () => {
  it('moves files, creates folders, journals before moving, updates the manifest', async () => {
    const root = await tree({ 'a.pdf': 'A', 'b.jpg': 'B', 'keep.txt': 'K' })
    const { osTrash } = makeOsTrash()
    const progress: number[] = []

    const result = await applyToFolder(
      root,
      {
        strategy: STRATEGY,
        moves: [
          { source: 'a.pdf', destination: 'Docs/a.pdf' },
          { source: 'b.jpg', destination: 'Images/b.jpg' }
        ],
        trash: []
      },
      { osTrash, onProgress: (p) => progress.push(p.done) }
    )

    expect(result.moved).toBe(2)
    expect(result.skipped).toEqual([])
    expect(result.collisions).toEqual([])
    expect(progress).toEqual([1, 2])

    const files = await snapshotFiles(root)
    expect(files).toContain('Docs/a.pdf')
    expect(files).toContain('Images/b.jpg')
    expect(files).toContain('keep.txt')

    const { journal } = await readJournal(root)
    expect(journal.operations).toHaveLength(1)
    const op = journal.operations[0]
    expect(op.status).toBe('applied')
    expect(op.createdFolders.sort()).toEqual(['Docs', 'Images'])
    expect(op.moves.every((m) => m.status === 'moved')).toBe(true)
    expect(op.moves[0].postMoveSize).toBe(1)

    const manifest = await readManifest(root)
    expect(manifest).not.toBeNull()
    expect(Object.keys(manifest!.files).sort()).toEqual(['Docs/a.pdf', 'Images/b.jpg'])
    expect(manifest!.managedFolders.sort()).toEqual(['Docs', 'Images'])
  })

  it('suffixes name collisions and reports them', async () => {
    const root = await tree({ 'report.pdf': 'new', 'Docs/report.pdf': 'old' })
    const { osTrash } = makeOsTrash()
    const result = await applyToFolder(
      root,
      { strategy: STRATEGY, moves: [{ source: 'report.pdf', destination: 'Docs/report.pdf' }], trash: [] },
      { osTrash }
    )
    expect(result.collisions).toHaveLength(1)
    expect(result.collisions[0].finalDestination).toBe('Docs/report (1).pdf')
    const files = await snapshotFiles(root)
    expect(files).toContain('Docs/report.pdf')
    expect(files).toContain('Docs/report (1).pdf')
  })

  it('isolates per-file failures: unreadable file skipped, rest proceed', async () => {
    const root = await tree({ 'ok.txt': 'x', 'locked-dir/stuck.txt': 'y' })
    await fs.chmod(join(root, 'locked-dir'), 0o555) // can't move out of read-only dir
    const { osTrash } = makeOsTrash()
    try {
      const result = await applyToFolder(
        root,
        {
          strategy: STRATEGY,
          moves: [
            { source: 'locked-dir/stuck.txt', destination: 'Out/stuck.txt' },
            { source: 'ok.txt', destination: 'Out/ok.txt' }
          ],
          trash: []
        },
        { osTrash }
      )
      expect(result.moved).toBe(1)
      expect(result.skipped).toHaveLength(1)
      expect(result.skipped[0].reasonCode).toBe('permission')
      expect(await snapshotFiles(root)).toContain('Out/ok.txt')
      const { journal } = await readJournal(root)
      expect(journal.operations[0].status).toBe('partial')
    } finally {
      await fs.chmod(join(root, 'locked-dir'), 0o755)
    }
  })

  it('stages trashed duplicates inside .ordino/trash', async () => {
    const root = await tree({ 'dup.txt': 'D', 'dup copy.txt': 'D' })
    const { osTrash, trashed } = makeOsTrash()
    const result = await applyToFolder(
      root,
      { strategy: STRATEGY, moves: [], trash: [{ source: 'dup copy.txt' }] },
      { osTrash }
    )
    expect(result.trashed).toBe(1)
    expect(trashed).toEqual([]) // NOT OS-trashed yet — undo window open
    const { journal } = await readJournal(root)
    const trash = journal.operations[0].trashes[0]
    expect(trash.status).toBe('staged')
    const staged = join(root, ...trash.stagedAt!.split('/'))
    expect(await fs.readFile(staged, 'utf8')).toBe('D')
  })

  it('refuses to apply while a pending op exists', async () => {
    const root = await tree({ 'a.txt': 'x' })
    const { journal } = await readJournal(root)
    journal.operations.push({
      id: 'crashed',
      startedAt: Date.now(),
      strategy: STRATEGY,
      status: 'pending',
      createdFolders: [],
      moves: [],
      trashes: []
    })
    await fs.mkdir(join(root, '.ordino'), { recursive: true })
    await writeJournal(root, journal)
    const { osTrash } = makeOsTrash()
    await expect(
      applyToFolder(root, { strategy: STRATEGY, moves: [], trash: [] }, { osTrash })
    ).rejects.toSatisfy((e: unknown) => e instanceof OrdinoFailure && e.code === 'APPLY_IN_PROGRESS')
  })

  it('a second apply finalizes the previous op: staged trash reaches the OS trash', async () => {
    const root = await tree({ 'dup.txt': 'D', 'dup copy.txt': 'D', 'later.txt': 'L' })
    const { osTrash, trashed } = makeOsTrash()
    await applyToFolder(
      root,
      { strategy: STRATEGY, moves: [], trash: [{ source: 'dup copy.txt' }] },
      { osTrash }
    )
    await applyToFolder(
      root,
      { strategy: STRATEGY, moves: [{ source: 'later.txt', destination: 'Docs/later.txt' }], trash: [] },
      { osTrash }
    )
    expect(trashed).toHaveLength(1) // dup copy finally OS-trashed
    const { journal } = await readJournal(root)
    expect(journal.operations[0].status).toBe('finalized')
    expect(journal.operations[0].trashes[0].status).toBe('os-trashed')
    expect(journal.operations[1].status).toBe('applied')
  })
})

describe('undoLastOperation', () => {
  it('restores everything byte-identical, removes created folders, updates manifest', async () => {
    const spec: Record<string, string> = {
      'a.pdf': 'AAA',
      'sub/b.jpg': 'BB',
      'dup.txt': 'D',
      'dup copy.txt': 'D'
    }
    const root = await tree(spec)
    const before = await snapshotFiles(root)
    const { osTrash } = makeOsTrash()

    await applyToFolder(
      root,
      {
        strategy: STRATEGY,
        moves: [
          { source: 'a.pdf', destination: 'Docs/a.pdf' },
          { source: 'sub/b.jpg', destination: 'Images/b.jpg' }
        ],
        trash: [{ source: 'dup copy.txt' }]
      },
      { osTrash }
    )

    const avail = await undoAvailability(root)
    expect(avail).toMatchObject({ available: true, moveCount: 2, trashCount: 1, recovery: false })

    const result = await undoLastOperation(root)
    expect(result.restored).toBe(3)
    expect(result.restoredFromTrash).toBe(1)
    expect(result.removedFolders).toBe(2)
    expect(result.notRestored).toEqual([])

    const after = await snapshotFiles(root)
    expect(after.filter((f) => !f.startsWith('.ordino'))).toEqual(before)
    for (const [rel, content] of Object.entries(spec)) {
      expect(await fs.readFile(join(root, rel), 'utf8')).toBe(content)
    }

    const { journal } = await readJournal(root)
    expect(journal.operations[0].status).toBe('undone')
    expect((await undoAvailability(root)).available).toBe(false)

    const manifest = await readManifest(root)
    expect(Object.keys(manifest!.files)).toEqual([])
    expect(manifest!.managedFolders).toEqual([])
  })

  it('skips files the user modified after apply, restores the rest', async () => {
    const root = await tree({ 'a.txt': 'A', 'b.txt': 'B' })
    const { osTrash } = makeOsTrash()
    await applyToFolder(
      root,
      {
        strategy: STRATEGY,
        moves: [
          { source: 'a.txt', destination: 'X/a.txt' },
          { source: 'b.txt', destination: 'X/b.txt' }
        ],
        trash: []
      },
      { osTrash }
    )
    await fs.writeFile(join(root, 'X/a.txt'), 'A-changed-by-user')

    const result = await undoLastOperation(root)
    expect(result.restored).toBe(1)
    expect(result.notRestored).toEqual([
      { path: 'X/a.txt', reasonCode: 'modified' }
    ])
    const files = await snapshotFiles(root)
    expect(files).toContain('b.txt')
    expect(files).toContain('X/a.txt') // modified file left where it is
    // X not removed because it still holds a.txt
    expect(result.removedFolders).toBe(0)
  })

  it('skips when the original spot is occupied', async () => {
    const root = await tree({ 'a.txt': 'A' })
    const { osTrash } = makeOsTrash()
    await applyToFolder(
      root,
      { strategy: STRATEGY, moves: [{ source: 'a.txt', destination: 'X/a.txt' }], trash: [] },
      { osTrash }
    )
    await fs.writeFile(join(root, 'a.txt'), 'squatter')
    const result = await undoLastOperation(root)
    expect(result.restored).toBe(0)
    expect(result.notRestored[0]).toMatchObject({ path: 'a.txt', reasonCode: 'occupied' })
  })

  it('recovers a crashed (pending) apply: restores completed entries', async () => {
    const root = await tree({ 'a.txt': 'A', 'b.txt': 'B' })
    const { osTrash } = makeOsTrash()
    await applyToFolder(
      root,
      {
        strategy: STRATEGY,
        moves: [
          { source: 'a.txt', destination: 'X/a.txt' },
          { source: 'b.txt', destination: 'X/b.txt' }
        ],
        trash: []
      },
      { osTrash }
    )
    // Simulate the crash: rewind status to pending as if apply died mid-write.
    const { journal } = await readJournal(root)
    journal.operations[0].status = 'pending'
    await writeJournal(root, journal)

    const avail = await undoAvailability(root)
    expect(avail.recovery).toBe(true)

    const result = await undoLastOperation(root)
    expect(result.restored).toBe(2)
    expect((await snapshotFiles(root)).filter((f) => !f.startsWith('.ordino'))).toEqual([
      'a.txt',
      'b.txt'
    ])
  })

  it('journal survives restart (pure disk round-trip)', async () => {
    const root = await tree({ 'a.txt': 'A' })
    const { osTrash } = makeOsTrash()
    await applyToFolder(
      root,
      { strategy: STRATEGY, moves: [{ source: 'a.txt', destination: 'X/a.txt' }], trash: [] },
      { osTrash }
    )
    // A fresh read (≈ new process) sees the same undoable op.
    const avail = await undoAvailability(root)
    expect(avail.available).toBe(true)
    expect(avail.moveCount).toBe(1)
  })

  it('corrupt journal is preserved and treated as empty', async () => {
    const root = await tree({ 'a.txt': 'A' })
    await fs.mkdir(join(root, '.ordino'), { recursive: true })
    await fs.writeFile(join(root, '.ordino/journal.json'), '{ not json')
    const { journal, corrupt } = await readJournal(root)
    expect(corrupt).toBe(true)
    expect(journal.operations).toEqual([])
    const entries = await fs.readdir(join(root, '.ordino'))
    expect(entries.some((e) => e.startsWith('journal.json.corrupt-'))).toBe(true)
  })
})

describe('finalizeSupersededOps + collisions unit', () => {
  it('collision resolver counts upward', async () => {
    const root = await tree({ 'x/f.txt': '1', 'x/f (1).txt': '2' })
    const resolved = await resolveCollision(join(root, 'x/f.txt'))
    expect(resolved.collided).toBe(true)
    expect(resolved.finalAbs.endsWith('f (2).txt')).toBe(true)
  })

  it('direct OS-trash fallback when staging is impossible', async () => {
    const root = await tree({ 'dup.txt': 'D' })
    const osTrash = vi.fn(async (absPath: string) => {
      await fs.rm(absPath, { force: true })
    })
    // Make the staging dir un-creatable by occupying .ordino/trash with a file.
    await fs.mkdir(join(root, '.ordino'), { recursive: true })
    await fs.writeFile(join(root, '.ordino/trash'), 'not-a-dir')
    const result = await applyToFolder(
      root,
      { strategy: STRATEGY, moves: [], trash: [{ source: 'dup.txt' }] },
      { osTrash }
    )
    expect(result.trashed).toBe(1)
    expect(osTrash).toHaveBeenCalledOnce()
    const { journal } = await readJournal(root)
    expect(journal.operations[0].trashes[0].status).toBe('os-trashed')
  })
})
