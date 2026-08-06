import { describe, expect, it } from 'vitest'
import { validatePlan } from '@main/plan/validate'
import { normalizeRelPath, sanitizeFolderPath } from '@main/plan/normalize'

const ctx = {
  validSources: new Set(['invoice.pdf', 'photo.jpg', 'docs/old.txt', 'song copy.mp3']),
  existingFolders: new Set(['docs', 'Existing'])
}

describe('normalizeRelPath', () => {
  it('normalizes separators and dot segments', () => {
    expect(normalizeRelPath('.\\Invoices\\a.pdf')).toEqual({ ok: true, path: 'Invoices/a.pdf' })
    expect(normalizeRelPath('./a//b/./c.txt')).toEqual({ ok: true, path: 'a/b/c.txt' })
  })

  it('rejects escapes', () => {
    expect(normalizeRelPath('../outside.txt').ok).toBe(false)
    expect(normalizeRelPath('a/../../outside.txt').ok).toBe(false)
    expect(normalizeRelPath('/abs/path.txt').ok).toBe(false)
    expect(normalizeRelPath('C:\\win\\path.txt').ok).toBe(false)
    expect(normalizeRelPath('~/home.txt').ok).toBe(false)
    expect(normalizeRelPath('.ordino/journal.json').ok).toBe(false)
  })
})

describe('sanitizeFolderPath', () => {
  it('strips forbidden characters and trailing dots/spaces', () => {
    expect(sanitizeFolderPath('In:voi*ces?')).toEqual({ path: 'Invoices', changed: true })
    expect(sanitizeFolderPath('Docs. ')).toEqual({ path: 'Docs', changed: true })
    expect(sanitizeFolderPath('Clean Name')).toEqual({ path: 'Clean Name', changed: false })
  })

  it('suffixes Windows reserved names', () => {
    expect(sanitizeFolderPath('CON')).toEqual({ path: 'CON_', changed: true })
    expect(sanitizeFolderPath('aux/files')).toEqual({ path: 'aux_/files', changed: true })
  })

  it('returns null when nothing survives', () => {
    expect(sanitizeFolderPath('???')).toBeNull()
    expect(sanitizeFolderPath('.ordino')).toBeNull()
  })
})

describe('validatePlan', () => {
  it('accepts a clean plan and derives destFolder + newFolders', () => {
    const result = validatePlan(
      {
        newFolders: ['Invoices'],
        moves: [
          { source: 'invoice.pdf', destination: 'Invoices/invoice.pdf', reason: 'invoice' },
          { source: 'photo.jpg', destination: 'Photos/photo.jpg', reason: 'photo' }
        ]
      },
      ctx
    )
    expect(result.moves).toHaveLength(2)
    expect(result.moves[0]).toMatchObject({ destFolder: 'Invoices', destination: 'Invoices/invoice.pdf' })
    // Photos was referenced but not declared — still a new folder.
    expect(result.newFolders).toEqual(['Invoices', 'Photos'])
    expect(result.warnings).toHaveLength(0)
  })

  it('drops hallucinated sources with warnings', () => {
    const result = validatePlan(
      {
        newFolders: [],
        moves: [{ source: 'ghost.pdf', destination: 'X/ghost.pdf', reason: '' }]
      },
      ctx
    )
    expect(result.moves).toHaveLength(0)
    expect(result.warnings).toEqual([{ code: 'unknown-source-dropped', detail: 'ghost.pdf' }])
    expect(result.newFolders).toEqual([])
  })

  it('enforces no-rename by forcing the source basename', () => {
    const result = validatePlan(
      {
        newFolders: [],
        moves: [{ source: 'invoice.pdf', destination: 'Invoices/renamed.pdf', reason: '' }]
      },
      ctx
    )
    expect(result.moves[0].destination).toBe('Invoices/invoice.pdf')
    expect(result.warnings.some((w) => w.code === 'destination-rewritten')).toBe(true)
  })

  it('treats a bare folder destination as the target folder', () => {
    const result = validatePlan(
      { newFolders: [], moves: [{ source: 'photo.jpg', destination: 'Photos', reason: '' }] },
      ctx
    )
    expect(result.moves[0].destination).toBe('Photos/photo.jpg')
  })

  it('rejects traversal and .ordino destinations', () => {
    const result = validatePlan(
      {
        newFolders: [],
        moves: [
          { source: 'invoice.pdf', destination: '../outside/invoice.pdf', reason: '' },
          { source: 'photo.jpg', destination: '.ordino/photo.jpg', reason: '' }
        ]
      },
      ctx
    )
    expect(result.moves).toHaveLength(0)
  })

  it('dedupes by source (first wins) and drops no-ops', () => {
    const result = validatePlan(
      {
        newFolders: [],
        moves: [
          { source: 'invoice.pdf', destination: 'A/invoice.pdf', reason: 'first' },
          { source: 'invoice.pdf', destination: 'B/invoice.pdf', reason: 'second' },
          { source: 'docs/old.txt', destination: 'docs/old.txt', reason: 'no-op' }
        ]
      },
      ctx
    )
    expect(result.moves).toHaveLength(1)
    expect(result.moves[0].destFolder).toBe('A')
  })

  it('sanitizes folder names and reports it', () => {
    const result = validatePlan(
      {
        newFolders: [],
        moves: [{ source: 'photo.jpg', destination: 'Pho:tos?/photo.jpg', reason: '' }]
      },
      ctx
    )
    expect(result.moves[0].destFolder).toBe('Photos')
    expect(result.warnings.some((w) => w.code === 'folder-name-sanitized')).toBe(true)
  })

  it('includes parent folders of nested new destinations, excluding existing', () => {
    const result = validatePlan(
      {
        newFolders: [],
        moves: [{ source: 'photo.jpg', destination: '2026/03/photo.jpg', reason: '' }]
      },
      ctx
    )
    expect(result.newFolders).toEqual(['2026', '2026/03'])
  })

  it('does not list existing folders as new', () => {
    const result = validatePlan(
      {
        newFolders: ['Existing', 'docs'],
        moves: [{ source: 'photo.jpg', destination: 'Existing/photo.jpg', reason: '' }]
      },
      ctx
    )
    expect(result.newFolders).toEqual([])
  })
})
