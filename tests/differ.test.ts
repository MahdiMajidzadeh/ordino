import { afterEach, describe, expect, it } from 'vitest'
import { diffScanAgainstManifest, attachRerunDiff } from '@main/manifest/differ'
import { applyToFolder } from '@main/apply/engine'
import { scanFolder } from '@main/scanner/scan'
import { readManifest, writeManifest } from '@main/folder-state/store'
import type { ManifestFile } from '@main/folder-state/types'
import type { ScanResult } from '@shared/types'
import { promises as fs } from 'fs'
import { join } from 'path'
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

const STRATEGY = { id: 'smart' as const, reuseExistingFolders: true }

function manifestOf(files: string[], managedFolders: string[]): ManifestFile {
  return {
    version: 1,
    strategy: STRATEGY,
    updatedAt: 1000,
    managedFolders,
    files: Object.fromEntries(files.map((f) => [f, { size: 1, mtimeMs: 1, organizedAt: 1000 }]))
  }
}

async function scanOf(root: string): Promise<ScanResult> {
  return scanFolder(root, { ignoreGlobs: [] })
}

describe('diffScanAgainstManifest', () => {
  it('splits leave-alone vs organize; modified-in-place stays organized', async () => {
    const root = await tree({
      'Invoices/a.pdf': 'ORIGINAL — since modified, still organized',
      'new-loose.txt': 'n'
    })
    const scan = await scanOf(root)
    const { rerun } = diffScanAgainstManifest(scan, manifestOf(['Invoices/a.pdf'], ['Invoices']))
    expect(rerun.organizedFileIds).toEqual(['Invoices/a.pdf'])
    expect(rerun.newFileIds).toEqual(['new-loose.txt'])
    expect(rerun.nothingToDo).toBe(false)
  })

  it('prunes vanished files and renamed managed folders (user-owned now)', async () => {
    const root = await tree({ 'Renamed/a.pdf': 'x' })
    const scan = await scanOf(root)
    const manifest = manifestOf(['Invoices/a.pdf'], ['Invoices'])
    const { rerun, pruned, prunedAnything } = diffScanAgainstManifest(scan, manifest)
    expect(prunedAnything).toBe(true)
    expect(pruned.files).toEqual({})
    expect(pruned.managedFolders).toEqual([])
    // The renamed folder is just an existing dir now — not managed.
    expect(rerun.managedFolders).toEqual([])
    expect(rerun.newFileIds).toEqual(['Renamed/a.pdf'])
  })

  it('nothingToDo when every file is organized', async () => {
    const root = await tree({ 'Invoices/a.pdf': 'x', 'Invoices/b.pdf': 'y' })
    const scan = await scanOf(root)
    const { rerun } = diffScanAgainstManifest(
      scan,
      manifestOf(['Invoices/a.pdf', 'Invoices/b.pdf'], ['Invoices'])
    )
    expect(rerun.nothingToDo).toBe(true)
    expect(rerun.newFileIds).toEqual([])
  })
})

describe('attachRerunDiff end-to-end with apply', () => {
  it('after a real apply, a re-scan sees organized files and manages folders', async () => {
    const root = await tree({ 'a.pdf': 'A', 'b.jpg': 'B' })
    await applyToFolder(
      root,
      {
        strategy: STRATEGY,
        moves: [
          { source: 'a.pdf', destination: 'Docs/a.pdf' },
          { source: 'b.jpg', destination: 'Images/b.jpg' }
        ],
        trash: []
      },
      { osTrash: async () => {} }
    )

    // Nothing new → fast path.
    let scan = await attachRerunDiff(await scanOf(root))
    expect(scan.rerun).not.toBeNull()
    expect(scan.rerun!.nothingToDo).toBe(true)
    expect(scan.rerun!.organizedFileIds.sort()).toEqual(['Docs/a.pdf', 'Images/b.jpg'])
    expect(scan.dirs.find((d) => d.relPath === 'Docs')!.managedByOrdino).toBe(true)

    // Drop in a new file → only it organizes; structure is preferred.
    await fs.writeFile(join(root, 'fresh.mp3'), 'F')
    scan = await attachRerunDiff(await scanOf(root))
    expect(scan.rerun!.nothingToDo).toBe(false)
    expect(scan.rerun!.newFileIds).toEqual(['fresh.mp3'])
    expect(scan.rerun!.managedFolders.sort()).toEqual(['Docs', 'Images'])
  })

  it('root rename keeps state (manifest travels with the folder)', async () => {
    const root = await tree({ 'a.pdf': 'A' })
    await applyToFolder(
      root,
      { strategy: STRATEGY, moves: [{ source: 'a.pdf', destination: 'Docs/a.pdf' }], trash: [] },
      { osTrash: async () => {} }
    )
    const renamed = `${root}-renamed`
    await fs.rename(root, renamed)
    roots.push(renamed)
    const scan = await attachRerunDiff(await scanFolder(renamed, { ignoreGlobs: [] }))
    expect(scan.rerun).not.toBeNull()
    expect(scan.rerun!.organizedFileIds).toEqual(['Docs/a.pdf'])
  })

  it('no manifest → no rerun attached', async () => {
    const root = await tree({ 'a.pdf': 'A' })
    const scan = await attachRerunDiff(await scanOf(root))
    expect(scan.rerun).toBeNull()
  })

  it('manifest pruning is persisted', async () => {
    const root = await tree({ 'kept.txt': 'x' })
    await fs.mkdir(join(root, '.ordino'), { recursive: true })
    await writeManifest(root, manifestOf(['kept.txt', 'gone.txt'], []))
    await attachRerunDiff(await scanOf(root))
    const after = await readManifest(root)
    expect(Object.keys(after!.files)).toEqual(['kept.txt'])
  })
})
