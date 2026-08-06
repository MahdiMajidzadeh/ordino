import type {
  DuplicateGroup,
  PlanMove,
  QuickScanSummary,
  RerunDiff,
  ScanDir,
  ScanFile,
  ScanResult
} from '@shared/types'
import type { StrategyConfig } from '@shared/strategies'

/**
 * Deterministic fixture generator for browser-only development. Seeded PRNG so
 * fixture ids stay stable across reloads (virtualizer/keyboard testing needs
 * stable row identity).
 */
function makeRng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 0xffffffff
  }
}

interface CategorySpec {
  key: string
  /** Destination folder under Smart Categories. */
  smartFolder: string
  /** Destination folder under File Type. */
  typeFolder: string
  exts: string[]
  names: string[]
}

const CATEGORIES: CategorySpec[] = [
  {
    key: 'invoices',
    smartFolder: 'Invoices',
    typeFolder: 'Documents',
    exts: ['pdf'],
    names: [
      'invoice-digikala-march',
      'receipt_2026',
      'invoice-aws-{n}',
      'billing-statement-{n}',
      'faktura-{n}',
      'receipt-appstore-{n}'
    ]
  },
  {
    key: 'screenshots',
    smartFolder: 'Screenshots',
    typeFolder: 'Images',
    exts: ['png'],
    names: ['Screenshot 2026-0{m}-{d} at 1{d}.2{m}', 'Screen Shot {n}', 'CleanShot 2026-0{m}-{d}']
  },
  {
    key: 'photos',
    smartFolder: 'Photos',
    typeFolder: 'Images',
    exts: ['jpg', 'heic'],
    names: ['IMG_{nnnn}', 'DSC0{nnnn}', 'PXL_2026{nnnn}']
  },
  {
    key: 'music',
    smartFolder: 'Music',
    typeFolder: 'Audio',
    exts: ['mp3', 'flac'],
    names: ['track-{n}', 'live-session-{n}', 'podcast-episode-{n}']
  },
  {
    key: 'docs',
    smartFolder: 'Documents',
    typeFolder: 'Documents',
    exts: ['docx', 'md', 'txt'],
    names: ['meeting-notes-{n}', 'proposal-v{d}', 'README-old', 'draft_{n}', 'contract-{n}']
  },
  {
    key: 'sheets',
    smartFolder: 'Spreadsheets',
    typeFolder: 'Documents',
    exts: ['xlsx', 'csv'],
    names: ['budget-2026-q{d}', 'export-{nnnn}', 'timesheet-{n}']
  },
  {
    key: 'code',
    smartFolder: 'Code',
    typeFolder: 'Code',
    exts: ['ts', 'py', 'sh'],
    names: ['scratch-{n}', 'migrate_{n}', 'test-script-{n}']
  },
  {
    key: 'archives',
    smartFolder: 'Archives',
    typeFolder: 'Archives',
    exts: ['zip', 'tar.gz'],
    names: ['backup-{nnnn}', 'website-export-{n}', 'photos-{n}']
  },
  {
    key: 'models3d',
    smartFolder: '3D Models',
    typeFolder: 'Other',
    exts: ['stl', '3mf'],
    names: ['benchy-remix-{n}', 'phone-stand-v{d}', 'gridfinity-bin-{n}x{d}']
  }
]

export interface FixtureSpec {
  id: string
  seed: number
  fileCount: number
  /** Loose subfolders that already exist (also usable as destinations). */
  existingDirs: string[]
  duplicatePairs: number
  rerun: boolean
}

export const FIXTURE_SPECS: FixtureSpec[] = [
  { id: 'small', seed: 11, fileCount: 20, existingDirs: ['Old stuff'], duplicatePairs: 1, rerun: false },
  {
    id: 'medium',
    seed: 42,
    fileCount: 200,
    existingDirs: ['Old stuff', 'Projects', 'Projects/Alpha'],
    duplicatePairs: 3,
    rerun: false
  },
  {
    id: 'large',
    seed: 7,
    fileCount: 5000,
    existingDirs: ['Archive 2019', 'Projects', 'Projects/Alpha', 'Projects/Beta'],
    duplicatePairs: 12,
    rerun: false
  },
  {
    id: 'dupes',
    seed: 99,
    fileCount: 60,
    existingDirs: ['Old stuff'],
    duplicatePairs: 14,
    rerun: false
  },
  {
    id: 'rerun',
    seed: 42,
    fileCount: 200,
    existingDirs: ['Old stuff', 'Projects'],
    duplicatePairs: 2,
    rerun: true
  }
]

export interface Fixture {
  id: string
  rootPath: string
  quick: QuickScanSummary
  scan: ScanResult
  duplicateGroups: DuplicateGroup[]
  planMovesFor(strategy: StrategyConfig): { newFolders: string[]; moves: PlanMove[] }
}

function expandName(template: string, rng: () => number): string {
  return template
    .replaceAll('{nnnn}', () => String(1000 + Math.floor(rng() * 9000)))
    .replaceAll('{n}', () => String(1 + Math.floor(rng() * 99)))
    .replaceAll('{m}', () => String(1 + Math.floor(rng() * 9)))
    .replaceAll('{d}', () => String(1 + Math.floor(rng() * 8)))
}

export function buildFixture(spec: FixtureSpec): Fixture {
  const rng = makeRng(spec.seed)
  const rootName = spec.id === 'large' ? 'Downloads' : 'Messy Desktop'
  const rootPath = `/Users/demo/${rootName}`

  const files: ScanFile[] = []
  const fileCategory = new Map<string, CategorySpec>()
  const usedNames = new Set<string>()

  const now = Date.now()
  const managedFolders = spec.rerun ? ['Invoices', 'Screenshots', 'Documents'] : []

  for (let i = 0; i < spec.fileCount; i++) {
    const cat = CATEGORIES[Math.floor(rng() * CATEGORIES.length)]
    const ext = cat.exts[Math.floor(rng() * cat.exts.length)]
    let base = expandName(cat.names[Math.floor(rng() * cat.names.length)], rng)
    while (usedNames.has(`${base}.${ext}`)) base = `${base}-${Math.floor(rng() * 999)}`
    const name = `${base}.${ext}`
    usedNames.add(name)

    // In the rerun fixture ~70% of files already sit inside managed folders.
    let parentDir = ''
    if (spec.rerun && rng() < 0.7) {
      parentDir = managedFolders[Math.floor(rng() * managedFolders.length)]
    } else if (rng() < 0.12 && spec.existingDirs.length > 0) {
      parentDir = spec.existingDirs[Math.floor(rng() * spec.existingDirs.length)]
    }

    const relPath = parentDir ? `${parentDir}/${name}` : name
    const createdAt = now - Math.floor(rng() * 730) * 86400_000 - Math.floor(rng() * 86400_000)
    const file: ScanFile = {
      id: relPath,
      relPath,
      name,
      ext: ext.includes('.') ? ext.split('.').pop()! : ext,
      size: Math.floor(rng() * 24_000_000) + 1200,
      createdAt,
      modifiedAt: createdAt + Math.floor(rng() * 90) * 86400_000,
      parentDir,
      isSymlink: false
    }
    files.push(file)
    fileCategory.set(file.id, cat)
  }

  // Duplicate pairs: clone an original with a copy-marker name, same size.
  const duplicateGroups: DuplicateGroup[] = []
  for (let d = 0; d < spec.duplicatePairs && d < files.length; d++) {
    const original = files[Math.floor(rng() * files.length)]
    if (original.name.includes('copy')) continue
    const dot = original.name.lastIndexOf('.')
    const copyName = `${original.name.slice(0, dot)} copy${d % 2 === 0 ? '' : ` ${d}`}${original.name.slice(dot)}`
    const copy: ScanFile = {
      ...original,
      id: copyName,
      relPath: copyName,
      name: copyName,
      parentDir: '',
      createdAt: original.createdAt + 86400_000,
      modifiedAt: original.modifiedAt + 86400_000
    }
    files.push(copy)
    fileCategory.set(copy.id, fileCategory.get(original.id)!)
    duplicateGroups.push({
      id: `dup-${d}`,
      size: original.size,
      fileIds: [original.id, copy.id],
      recommendedKeeperId: original.id,
      keeperReasonCode: 'clean-name'
    })
  }

  // Directory rows: existing dirs + managed folders, with per-dir file counts.
  const allDirs = [...new Set([...spec.existingDirs, ...managedFolders])].sort()
  const dirs: ScanDir[] = allDirs.map((relPath) => {
    const name = relPath.split('/').pop()!
    const parent = relPath.includes('/') ? relPath.slice(0, relPath.lastIndexOf('/')) : ''
    const direct = files.filter((f) => f.parentDir === relPath).length
    const total = files.filter((f) => f.parentDir === relPath || f.parentDir.startsWith(`${relPath}/`)).length
    return {
      relPath,
      name,
      parentDir: parent,
      fileCount: direct,
      totalFileCount: total,
      depth: relPath.split('/').length - 1,
      managedByOrdino: managedFolders.includes(relPath)
    }
  })

  const totalSize = files.reduce((acc, f) => acc + f.size, 0)

  let rerun: RerunDiff | null = null
  if (spec.rerun) {
    const organized = files.filter((f) => managedFolders.includes(f.parentDir)).map((f) => f.id)
    const fresh = files.filter((f) => !managedFolders.includes(f.parentDir)).map((f) => f.id)
    rerun = {
      manifestStrategy: { id: 'smart', reuseExistingFolders: true },
      organizedFileIds: organized,
      managedFolders,
      newFileIds: fresh,
      nothingToDo: fresh.length === 0,
      lastAppliedAt: now - 3 * 86400_000
    }
  }

  const scan: ScanResult = {
    scanId: `mock-scan-${spec.id}`,
    rootPath,
    rootName,
    files,
    dirs,
    totalSize,
    ignoredCount: 3,
    warnings: [],
    rerun
  }

  const quick: QuickScanSummary = {
    rootPath,
    rootName,
    fileCount: files.filter((f) => f.parentDir === '').length,
    dirCount: dirs.filter((d) => d.parentDir === '').length,
    totalSize
  }

  const planMovesFor = (strategy: StrategyConfig): { newFolders: string[]; moves: PlanMove[] } => {
    const moves: PlanMove[] = []
    const folders = new Set<string>()
    const organizedSet = new Set(rerun?.organizedFileIds ?? [])
    for (const file of files) {
      if (organizedSet.has(file.id)) continue
      const cat = fileCategory.get(file.id)!
      let destFolder: string
      if (strategy.id === 'fileType') destFolder = cat.typeFolder
      else if (strategy.id === 'date') {
        const dt = new Date(file.createdAt)
        destFolder =
          strategy.dateGranularity === 'year-month'
            ? `${dt.getFullYear()}/${String(dt.getMonth() + 1).padStart(2, '0')}`
            : String(dt.getFullYear())
      } else destFolder = cat.smartFolder
      if (file.parentDir === destFolder) continue
      folders.add(destFolder)
      moves.push({
        fileId: file.id,
        source: file.relPath,
        destination: `${destFolder}/${file.name}`,
        destFolder,
        reason: mockReason(strategy, cat, destFolder)
      })
    }
    const existing = new Set(allDirs)
    const newFolders = [...folders].filter((f) => !existing.has(f)).sort()
    return { newFolders, moves }
  }

  return { id: spec.id, rootPath, quick, scan, duplicateGroups, planMovesFor }
}

function mockReason(strategy: StrategyConfig, cat: CategorySpec, destFolder: string): string {
  if (strategy.id === 'fileType') return `Grouped by file type into ${destFolder}`
  if (strategy.id === 'date') return `Created in ${destFolder}`
  if (strategy.id === 'custom') return `Matches your instruction — filed under ${destFolder}`
  return `Looks like ${cat.smartFolder.toLowerCase()} based on its name`
}

const cache = new Map<string, Fixture>()

export function getFixture(id: string): Fixture {
  const spec = FIXTURE_SPECS.find((s) => s.id === id) ?? FIXTURE_SPECS[1]
  let fixture = cache.get(spec.id)
  if (!fixture) {
    fixture = buildFixture(spec)
    cache.set(spec.id, fixture)
  }
  return fixture
}
