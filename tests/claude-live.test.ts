import { promises as fs } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import { scanFolder } from '@main/scanner/scan'
import { generateRawPlan } from '@main/providers/orchestrator'
import { ClaudeCliProvider } from '@main/providers/claude-cli'
import { validatePlan } from '@main/plan/validate'
import { detectDuplicates } from '@main/duplicates/detector'
import { applyToFolder } from '@main/apply/engine'
import { undoLastOperation } from '@main/apply/undo'
import { attachRerunDiff } from '@main/manifest/differ'
import { makeTree, removeTree, snapshotFiles } from './helpers/fixture-fs'

/**
 * LIVE end-to-end: real installed Claude Code, real files, full pipeline —
 * scan → AI plan → validate → apply → re-run diff → undo → byte-identical.
 * Costs real tokens; opt in with RUN_CLAUDE_LIVE=1.
 */
const LIVE = process.env.RUN_CLAUDE_LIVE === '1'

const roots: string[] = []
afterEach(async () => {
  await Promise.all(roots.splice(0).map(removeTree))
})

describe.skipIf(!LIVE)('live Claude Code pipeline', () => {
  it(
    'organizes a real messy folder end-to-end with full undo',
    { timeout: 240_000 },
    async () => {
      const spec: Record<string, string> = {
        'invoice-digikala-march.pdf': 'pdf1',
        'receipt_2026.pdf': 'pdf2',
        'billing-statement-7.pdf': 'pdf3',
        'Screenshot 2026-05-01 at 10.22.png': 'img1',
        'CleanShot 2026-03-02.png': 'img2',
        'IMG_2043.jpg': 'photo1',
        'IMG_2044.jpg': 'photo2',
        'benchy-remix-3.stl': 'model1',
        'gridfinity-bin-4x2.3mf': 'model2',
        'phone-stand-v2.stl': 'model3',
        'meeting-notes-42.md': 'doc1',
        'proposal-v3.docx': 'doc2',
        'budget-2026-q2.xlsx': 'sheet1',
        'track-01.mp3': 'audio1',
        'live-session-9.flac': 'audio2',
        'backup-2025.zip': 'arch1',
        'website-export.tar.gz': 'arch2',
        'scratch-test.py': 'code1',
        'migrate_users.sh': 'code2',
        'IMG_2043 copy.jpg': 'photo1', // duplicate of IMG_2043.jpg
        'Existing Docs/already-sorted.pdf': 'pdf9'
      }
      const root = await makeTree(spec)
      roots.push(root)
      const before = (await snapshotFiles(root)).filter((f) => !f.startsWith('.ordino'))

      // 1. Scan
      const scan = await scanFolder(root, { ignoreGlobs: [] })
      expect(scan.files.length).toBe(Object.keys(spec).length)

      // 2. AI plan via the user's installed Claude Code (haiku = cheapest)
      const provider = await ClaudeCliProvider.create({
        model: 'haiku',
        cliPathOverride: '',
        apiKey: null
      })
      const signal = new AbortController().signal
      const started = performance.now()
      const [raw, dupes] = await Promise.all([
        generateRawPlan(
          provider,
          {
            strategy: { id: 'smart', reuseExistingFolders: true },
            rootName: 'Messy Test',
            files: scan.files,
            existingFolders: scan.dirs.map((d) => d.relPath),
            preferredDestinations: []
          },
          signal,
          () => {}
        ),
        detectDuplicates(root, scan.files, {})
      ])
      const planSeconds = (performance.now() - started) / 1000
      console.log(`live plan generated in ${planSeconds.toFixed(1)}s, ${raw.moves.length} moves`)
      expect(planSeconds).toBeLessThan(120)

      // 3. Validate
      const validated = validatePlan(raw, {
        validSources: new Set(scan.files.map((f) => f.relPath)),
        existingFolders: new Set(scan.dirs.map((d) => d.relPath))
      })
      // Semantic quality floor: most loose files should get a destination.
      expect(validated.moves.length).toBeGreaterThanOrEqual(15)
      // Local duplicate detection found the copy pair.
      expect(dupes).toHaveLength(1)

      // 4. Apply (trash the duplicate copy too). Trashed files never move
      // (the renderer excludes them via effectiveMovesOf); unmoved in-scope
      // files are recorded in-place, mirroring the IPC handler (Goal 7).
      const applyMoves = validated.moves.filter((m) => m.source !== 'IMG_2043 copy.jpg')
      const movedIds = new Set(applyMoves.map((m) => m.source))
      const recordInPlace = scan.files
        .filter((f) => !movedIds.has(f.relPath) && f.relPath !== 'IMG_2043 copy.jpg')
        .map((f) => ({ path: f.relPath, size: f.size, mtimeMs: f.modifiedAt }))
      const applyResult = await applyToFolder(
        root,
        {
          strategy: { id: 'smart', reuseExistingFolders: true },
          moves: applyMoves.map((m) => ({ source: m.source, destination: m.destination })),
          trash: [{ source: 'IMG_2043 copy.jpg' }],
          recordInPlace
        },
        { osTrash: async () => {} }
      )
      expect(applyResult.failed).toEqual([])
      expect(applyResult.moved).toBe(applyMoves.length - applyResult.skipped.length)

      // 5. Re-run diff: everything organized, nothing to do
      const rescan = await attachRerunDiff(await scanFolder(root, { ignoreGlobs: [] }))
      expect(rescan.rerun).not.toBeNull()
      expect(rescan.rerun!.nothingToDo).toBe(true)

      // 6. Undo: byte-identical restore
      const undoResult = await undoLastOperation(root)
      expect(undoResult.notRestored).toEqual([])
      const after = (await snapshotFiles(root)).filter((f) => !f.startsWith('.ordino'))
      expect(after).toEqual(before)
      for (const [rel, content] of Object.entries(spec)) {
        expect(await fs.readFile(join(root, rel), 'utf8')).toBe(content)
      }
    }
  )
})
