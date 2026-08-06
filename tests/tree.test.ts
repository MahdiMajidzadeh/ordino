import { describe, expect, it } from 'vitest'
import type { ScanDir, ScanFile } from '@shared/types'
import { ancestorDirs, buildScanTree, dirRowId, fileRowId, flattenTree } from '@renderer/lib/tree'
import {
  checkStateOf,
  countIncludedFiles,
  effectiveChoice,
  toggleDir
} from '@renderer/lib/inclusion'

function dir(relPath: string, extra: Partial<ScanDir> = {}): ScanDir {
  return {
    relPath,
    name: relPath.split('/').pop()!,
    parentDir: relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '',
    fileCount: 0,
    totalFileCount: 0,
    depth: relPath.split('/').length - 1,
    managedByOrdino: false,
    ...extra
  }
}

function file(relPath: string): ScanFile {
  const name = relPath.split('/').pop()!
  return {
    id: relPath,
    relPath,
    name,
    ext: name.includes('.') ? name.split('.').pop()! : '',
    size: 1,
    createdAt: 0,
    modifiedAt: 0,
    parentDir: relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : '',
    isSymlink: false
  }
}

describe('ancestorDirs', () => {
  it('lists ancestors nearest-first', () => {
    expect(ancestorDirs('a/b/c/file.txt')).toEqual(['a/b/c', 'a/b', 'a'])
    expect(ancestorDirs('file.txt')).toEqual([])
  })
})

describe('buildScanTree + flattenTree', () => {
  const dirs = [dir('Projects'), dir('Projects/Alpha'), dir('zeta')]
  const files = [file('b.txt'), file('a.txt'), file('Projects/notes.md'), file('Projects/Alpha/x.ts')]

  it('nests dirs and files, folders first, natural sort', () => {
    const roots = buildScanTree(dirs, files)
    expect(roots.map((n) => n.name)).toEqual(['Projects', 'zeta', 'a.txt', 'b.txt'])
    const projects = roots[0]
    expect(projects.children!.map((n) => n.name)).toEqual(['Alpha', 'notes.md'])
  })

  it('flatten respects expansion', () => {
    const roots = buildScanTree(dirs, files)
    const collapsed = flattenTree(roots, new Set())
    expect(collapsed.map((r) => r.name)).toEqual(['Projects', 'zeta', 'a.txt', 'b.txt'])

    const expanded = flattenTree(roots, new Set([dirRowId('Projects'), dirRowId('Projects/Alpha')]))
    expect(expanded.map((r) => r.name)).toEqual([
      'Projects',
      'Alpha',
      'x.ts',
      'notes.md',
      'zeta',
      'a.txt',
      'b.txt'
    ])
    const alphaRow = expanded.find((r) => r.name === 'Alpha')!
    expect(alphaRow.depth).toBe(1)
    expect(alphaRow.parentId).toBe(dirRowId('Projects'))
    expect(expanded.find((r) => r.name === 'x.ts')!.id).toBe(fileRowId('Projects/Alpha/x.ts'))
  })
})

describe('inclusion tri-state', () => {
  const dirs = [dir('a'), dir('a/b'), dir('a/b/c'), dir('d')]

  it('inherits from nearest explicit ancestor, default include', () => {
    expect(effectiveChoice('a/b/c', {})).toBe('include')
    expect(effectiveChoice('a/b/c', { a: 'skip' })).toBe('skip')
    expect(effectiveChoice('a/b/c', { a: 'skip', 'a/b': 'include' })).toBe('include')
    expect(effectiveChoice('a/b/c', { 'a/b/c': 'skip', a: 'include' })).toBe('skip')
  })

  it('computes checked / unchecked / indeterminate', () => {
    expect(checkStateOf('a', dirs, {})).toBe('checked')
    expect(checkStateOf('a', dirs, { a: 'skip' })).toBe('unchecked')
    expect(checkStateOf('a', dirs, { 'a/b/c': 'skip' })).toBe('indeterminate')
    expect(checkStateOf('d', dirs, { 'a/b/c': 'skip' })).toBe('checked')
  })

  it('toggle cascades by clearing descendants', () => {
    const explicit = { 'a/b': 'skip' as const, d: 'skip' as const }
    const next = toggleDir('a', true, explicit)
    expect(next).toEqual({ a: 'include', d: 'skip' })
    const off = toggleDir('a', false, next)
    expect(off).toEqual({ a: 'skip', d: 'skip' })
  })

  it('counts included files through the chain', () => {
    const files = [file('root.txt'), file('a/x.txt'), file('a/b/y.txt'), file('d/z.txt')]
    expect(countIncludedFiles(files, {})).toBe(4)
    expect(countIncludedFiles(files, { a: 'skip' })).toBe(2)
    expect(countIncludedFiles(files, { a: 'skip', 'a/b': 'include' })).toBe(3)
  })
})
