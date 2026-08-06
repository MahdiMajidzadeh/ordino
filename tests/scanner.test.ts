import { promises as fs } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanFolder } from '@main/scanner/scan'
import { compileIgnoreGlobs, DEFAULT_IGNORE_GLOBS } from '@main/scanner/globs'
import { isHiddenOrSystemEntry } from '@main/scanner/filters'
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

describe('filters', () => {
  it('excludes hidden and system entries', () => {
    for (const name of ['.DS_Store', '.git', '.ordino', 'Thumbs.db', 'desktop.ini', '~$doc.docx', 'Icon\r']) {
      expect(isHiddenOrSystemEntry(name), name).toBe(true)
    }
    for (const name of ['report.pdf', 'photo.jpg', 'node_modules']) {
      expect(isHiddenOrSystemEntry(name), name).toBe(false)
    }
  })
})

describe('ignore globs', () => {
  it('matches by name and by rel path, case-insensitive', () => {
    const m = compileIgnoreGlobs(['node_modules', '*.tmp', 'build/**'])
    expect(m('project/node_modules', 'node_modules')).toBe(true)
    expect(m('scratch.TMP', 'scratch.TMP')).toBe(true)
    expect(m('build/out/x.js', 'x.js')).toBe(true)
    expect(m('src/index.ts', 'index.ts')).toBe(false)
  })

  it('empty pattern list matches nothing', () => {
    const m = compileIgnoreGlobs([])
    expect(m('anything', 'anything')).toBe(false)
  })
})

describe('scanFolder', () => {
  it('produces files, dirs, counts and sizes', async () => {
    const root = await tree({
      'invoice.pdf': '12345',
      'photo.jpg': 'abcdefgh',
      'docs/readme.md': 'hi',
      'docs/deep/notes.txt': 'notes',
      'empty/': null
    })
    const result = await scanFolder(root, { ignoreGlobs: [] })
    expect(result.files.map((f) => f.relPath).sort()).toEqual([
      'docs/deep/notes.txt',
      'docs/readme.md',
      'invoice.pdf',
      'photo.jpg'
    ])
    expect(result.totalSize).toBe(5 + 8 + 2 + 5)

    const docs = result.dirs.find((d) => d.relPath === 'docs')!
    expect(docs.fileCount).toBe(1)
    expect(docs.totalFileCount).toBe(2)
    const deep = result.dirs.find((d) => d.relPath === 'docs/deep')!
    expect(deep.depth).toBe(1)
    expect(deep.parentDir).toBe('docs')
    expect(result.dirs.find((d) => d.relPath === 'empty')!.totalFileCount).toBe(0)

    const invoice = result.files.find((f) => f.relPath === 'invoice.pdf')!
    expect(invoice.ext).toBe('pdf')
    expect(invoice.parentDir).toBe('')
    expect(invoice.size).toBe(5)
    expect(invoice.modifiedAt).toBeGreaterThan(0)
  })

  it('excludes hidden/system files and .ordino, counting them as ignored', async () => {
    const root = await tree({
      'real.txt': 'x',
      '.DS_Store': 'junk',
      '.hidden-dir/inside.txt': 'y',
      '.ordino/journal.json': '{}',
      'Thumbs.db': 'junk'
    })
    const result = await scanFolder(root, { ignoreGlobs: [] })
    expect(result.files.map((f) => f.relPath)).toEqual(['real.txt'])
    expect(result.dirs).toHaveLength(0)
    expect(result.ignoredCount).toBe(4) // .DS_Store, .hidden-dir, .ordino, Thumbs.db
  })

  it('prunes ignore-glob directories without recursing into them', async () => {
    const root = await tree({
      'keep.ts': 'x',
      'node_modules/pkg/index.js': 'x',
      'node_modules/pkg/deep/very/deep.js': 'x',
      'cache.tmp': 'x'
    })
    const result = await scanFolder(root, { ignoreGlobs: DEFAULT_IGNORE_GLOBS })
    expect(result.files.map((f) => f.relPath)).toEqual(['keep.ts'])
    expect(result.dirs.find((d) => d.relPath === 'node_modules')).toBeUndefined()
  })

  it('reports symlinks as file entries and never follows them', async () => {
    const root = await tree({
      'real-dir/inside.txt': 'x',
      'real-file.txt': 'y'
    })
    await fs.symlink(join(root, 'real-dir'), join(root, 'dir-link'))
    await fs.symlink(join(root, 'real-file.txt'), join(root, 'file-link'))
    await fs.symlink(join(root, 'nowhere'), join(root, 'broken-link'))

    const result = await scanFolder(root, { ignoreGlobs: [] })
    const links = result.files.filter((f) => f.isSymlink).map((f) => f.relPath)
    expect(links.sort()).toEqual(['broken-link', 'dir-link', 'file-link'])
    // dir-link is NOT a dir row and inside.txt appears exactly once.
    expect(result.dirs.map((d) => d.relPath)).toEqual(['real-dir'])
    expect(result.files.filter((f) => f.name === 'inside.txt')).toHaveLength(1)
  })

  it('records unreadable dirs as warnings and continues', async () => {
    const root = await tree({ 'ok.txt': 'x', 'locked/secret.txt': 'y' })
    await fs.chmod(join(root, 'locked'), 0o000)
    try {
      const result = await scanFolder(root, { ignoreGlobs: [] })
      expect(result.files.map((f) => f.relPath)).toEqual(['ok.txt'])
      expect(result.warnings.some((w) => w.relPath === 'locked' && w.reasonCode === 'unreadable')).toBe(
        true
      )
    } finally {
      await fs.chmod(join(root, 'locked'), 0o755)
    }
  })

  it('scans 1,000 files well under the 2s target', async () => {
    const spec: Record<string, string> = {}
    for (let i = 0; i < 1000; i++) {
      spec[`dir${i % 20}/file-${i}.dat`] = `content-${i}`
    }
    const root = await tree(spec)
    const started = performance.now()
    const result = await scanFolder(root, { ignoreGlobs: DEFAULT_IGNORE_GLOBS })
    const elapsed = performance.now() - started
    expect(result.files).toHaveLength(1000)
    expect(elapsed).toBeLessThan(2000)
  }, 10_000)
})
