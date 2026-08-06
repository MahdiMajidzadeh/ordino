import type { ScanDir, ScanFile } from '@shared/types'
import { ancestorDirs } from '@shared/inclusion'

export { ancestorDirs }

/**
 * Generic tree model shared by the three tree uses (inclusion / current /
 * proposed). Builders produce TreeNode[]; flattenTree turns them into the
 * FlatRow[] the virtualizer renders. Row ids are prefixed ('d:' / 'f:') so a
 * folder and file can never collide.
 */
export type RowStatus =
  | 'default'
  | 'new' // folder created by the plan
  | 'moved' // file at its proposed new location (right pane)
  | 'moved-away' // file's old location (left pane ghost)
  | 'unchanged' // dimmed: not part of the plan / already organized
  | 'excluded' // user unchecked it
  | 'trash' // duplicate marked for trash

export type RowBadge = 'managed' | 'new' | 'skipped' | 'edited' | 'duplicate'

export interface TreeNode {
  id: string
  kind: 'folder' | 'file'
  name: string
  /** Folder: root-relative dir path. File: fileId (= relPath). */
  path: string
  ext?: string
  status: RowStatus
  badge?: RowBadge
  /** Folder rows: number of files inside (recursive). */
  count?: number
  /** Review checkbox state for file rows; undefined hides the checkbox. */
  included?: boolean
  children?: TreeNode[]
}

export interface FlatRow {
  id: string
  kind: 'folder' | 'file'
  name: string
  path: string
  ext?: string
  status: RowStatus
  badge?: RowBadge
  count?: number
  included?: boolean
  depth: number
  hasChildren: boolean
  parentId: string | null
}

export const dirRowId = (dirPath: string): string => `d:${dirPath}`
export const fileRowId = (fileId: string): string => `f:${fileId}`

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return nodes.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'folder' ? -1 : 1
    return collator.compare(a.name, b.name)
  })
}

/** Depth-first flatten of expanded nodes into virtualizer rows. */
export function flattenTree(roots: TreeNode[], expanded: ReadonlySet<string>): FlatRow[] {
  const rows: FlatRow[] = []
  function visit(node: TreeNode, depth: number, parentId: string | null): void {
    const hasChildren = (node.children?.length ?? 0) > 0
    rows.push({
      id: node.id,
      kind: node.kind,
      name: node.name,
      path: node.path,
      ext: node.ext,
      status: node.status,
      badge: node.badge,
      count: node.count,
      included: node.included,
      depth,
      hasChildren,
      parentId
    })
    if (hasChildren && expanded.has(node.id)) {
      for (const child of node.children!) visit(child, depth + 1, node.id)
    }
  }
  for (const root of roots) visit(root, 0, null)
  return rows
}

/**
 * Build the current-structure tree from a scan: real dirs + files, statuses
 * supplied by the caller (all 'default' in the plain case).
 */
export function buildScanTree(
  dirs: readonly ScanDir[],
  files: readonly ScanFile[],
  opts: {
    includeFiles?: boolean
    fileStatus?: (file: ScanFile) => RowStatus
    fileBadge?: (file: ScanFile) => RowBadge | undefined
    fileIncluded?: (file: ScanFile) => boolean | undefined
    dirStatus?: (dir: ScanDir) => RowStatus
    dirBadge?: (dir: ScanDir) => RowBadge | undefined
  } = {}
): TreeNode[] {
  const includeFiles = opts.includeFiles ?? true
  const nodeByDir = new Map<string, TreeNode>()
  const roots: TreeNode[] = []

  for (const dir of dirs) {
    nodeByDir.set(dir.relPath, {
      id: dirRowId(dir.relPath),
      kind: 'folder',
      name: dir.name,
      path: dir.relPath,
      status: opts.dirStatus?.(dir) ?? 'default',
      badge: opts.dirBadge?.(dir),
      count: dir.totalFileCount,
      children: []
    })
  }
  for (const dir of dirs) {
    const node = nodeByDir.get(dir.relPath)!
    const parent = dir.parentDir === '' || dir.parentDir === null ? null : nodeByDir.get(dir.parentDir)
    if (parent) parent.children!.push(node)
    else roots.push(node)
  }

  if (includeFiles) {
    for (const file of files) {
      const node: TreeNode = {
        id: fileRowId(file.id),
        kind: 'file',
        name: file.name,
        path: file.id,
        ext: file.ext,
        status: opts.fileStatus?.(file) ?? 'default',
        badge: opts.fileBadge?.(file),
        included: opts.fileIncluded?.(file)
      }
      const parent = file.parentDir === '' ? null : nodeByDir.get(file.parentDir)
      if (parent) parent.children!.push(node)
      else roots.push(node)
    }
  }

  for (const node of nodeByDir.values()) sortNodes(node.children!)
  return sortNodes(roots)
}

