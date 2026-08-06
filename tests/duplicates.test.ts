import { afterEach, describe, expect, it } from 'vitest'
import { detectDuplicates, type DuplicateProgressUpdate } from '@main/duplicates/detector'
import { pickKeeper } from '@main/duplicates/keeper'
import { scanFolder } from '@main/scanner/scan'
import type { ScanFile } from '@shared/types'
import { makeTree, removeTree } from './helpers/fixture-fs'

const roots: string[] = []
async function tree(spec: Record<string, string | null>): Promise<string> {
  const root = await makeTree(spec)
  roots.push(root)
  return root
}
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTree))
})

function fakeFile(relPath: string, extra: Partial<ScanFile> = {}): ScanFile {
  const name = relPath.split('/').pop()!
  return {
    id: relPath,
    relPath,
    name,
    ext: name.includes('.') ? name.split('.').pop()! : '',
    size: 100,
    createdAt: 1000,
    modifiedAt: 1000,
    parentDir: relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '',
    isSymlink: false,
    ...extra
  }
}

describe('detectDuplicates', () => {
  it('groups identical content, ignores same-size different content', async () => {
    const root = await tree({
      'a.txt': 'same-content!',
      'sub/b.txt': 'same-content!',
      'c.txt': 'DIFFERENT-12!', // same length as the others, different bytes
      'unique.txt': 'totally unique length here'
    })
    const scan = await scanFolder(root, { ignoreGlobs: [] })
    const groups = await detectDuplicates(root, scan.files)
    expect(groups).toHaveLength(1)
    expect(groups[0].fileIds.sort()).toEqual(['a.txt', 'sub/b.txt'])
    expect(groups[0].size).toBe('same-content!'.length)
  })

  it('hashes only size-matched candidates (progress reflects candidate set)', async () => {
    const root = await tree({
      'one.txt': 'aa',
      'two.txt': 'bbbb',
      'three.txt': 'cccccc' // all unique sizes → zero candidates
    })
    const scan = await scanFolder(root, { ignoreGlobs: [] })
    const updates: DuplicateProgressUpdate[] = []
    const groups = await detectDuplicates(root, scan.files, { onProgress: (u) => updates.push(u) })
    expect(groups).toEqual([])
    expect(updates[updates.length - 1]).toMatchObject({ candidates: 0, done: true })
  })

  it('skips zero-byte files and symlinks', async () => {
    const root = await tree({ 'empty1.txt': '', 'empty2.txt': '', 'real.txt': 'x' })
    const scan = await scanFolder(root, { ignoreGlobs: [] })
    const groups = await detectDuplicates(root, scan.files)
    expect(groups).toEqual([])
  })

  it('cancellation aborts mid-hash', async () => {
    const spec: Record<string, string> = {}
    const body = 'z'.repeat(200_000)
    for (let i = 0; i < 30; i++) spec[`f${i}.bin`] = body
    const root = await tree(spec)
    const scan = await scanFolder(root, { ignoreGlobs: [] })
    const controller = new AbortController()
    const promise = detectDuplicates(root, scan.files, {
      signal: controller.signal,
      onProgress: (u) => {
        if (u.hashed >= 2) controller.abort()
      }
    })
    await expect(promise).rejects.toThrow()
  })
})

describe('pickKeeper', () => {
  it('prefers the manifest-organized copy', () => {
    const group = [fakeFile('loose.pdf'), fakeFile('Invoices/kept.pdf')]
    const result = pickKeeper(group, new Set(['Invoices/kept.pdf']))
    expect(result).toEqual({ keeperId: 'Invoices/kept.pdf', reasonCode: 'organized' })
  })

  it('prefers names without copy markers', () => {
    for (const marker of ['report (1).pdf', 'report copy.pdf', 'Copy of report.pdf', 'report copy 2.pdf']) {
      const group = [fakeFile(marker), fakeFile('report.pdf')]
      const result = pickKeeper(group, new Set())
      expect(result, marker).toEqual({ keeperId: 'report.pdf', reasonCode: 'clean-name' })
    }
  })

  it('falls back to oldest, then shortest path', () => {
    const oldest = pickKeeper(
      [fakeFile('a.txt', { createdAt: 2000 }), fakeFile('b.txt', { createdAt: 500 })],
      new Set()
    )
    expect(oldest).toEqual({ keeperId: 'b.txt', reasonCode: 'oldest' })

    const shortest = pickKeeper([fakeFile('deep/nested/a.txt'), fakeFile('a.txt')], new Set())
    expect(shortest).toEqual({ keeperId: 'a.txt', reasonCode: 'shortest-path' })
  })
})
