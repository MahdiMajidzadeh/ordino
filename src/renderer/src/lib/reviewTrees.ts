import type { Plan, ScanResult } from '@shared/types'
import type { DupeChoice, EffectiveMove } from '../stores/planSlice'
import { dirRowId, sortNodes, type TreeNode } from './tree'

/**
 * Pure derivation of both review panes from (scan, plan, decisions). The
 * right pane always previews the exact end state (P0-5): excluding a move
 * returns the file to its original spot dimmed; a new folder vanishes when
 * every inbound file is excluded; trashed duplicates leave the tree.
 */
export interface ReviewStats {
  includedMoves: number
  targetFolders: number
  newFolderCount: number
  excluded: number
  duplicateGroups: number
  trashed: number
}

export interface ReviewTrees {
  left: TreeNode[]
  right: TreeNode[]
  stats: ReviewStats
  trashedFileIds: string[]
  /** Expand-by-default sets (folders involved in changes + their ancestors). */
  defaultExpandedLeft: Set<string>
  defaultExpandedRight: Set<string>
  /** Candidate destination folders for the reassign control (P1-1). */
  reassignTargets: string[]
}

interface VirtualDir {
  relPath: string
  isNew: boolean
}

function ancestorsOf(path: string): string[] {
  const out: string[] = []
  let idx = path.indexOf('/')
  while (idx !== -1) {
    out.push(path.slice(0, idx))
    idx = path.indexOf('/', idx + 1)
  }
  return out
}

export function buildReviewTrees(
  scan: ScanResult,
  plan: Plan,
  moves: EffectiveMove[],
  dupeChoices: Record<string, DupeChoice>
): ReviewTrees {
  const moveByFile = new Map(moves.map((m) => [m.fileId, m]))
  const dupeFileIds = new Set(plan.duplicateGroups.flatMap((g) => g.fileIds))
  const organizedSet = new Set(plan.organizedFileIds)
  const trashedFileIds = scan.files
    .filter((f) => dupeChoices[f.id] === 'trash')
    .map((f) => f.id)
  const trashedSet = new Set(trashedFileIds)
  const existingDirSet = new Set(scan.dirs.map((d) => d.relPath))

  // ---- right pane (proposed) ----------------------------------------------
  const rightDirs = new Map<string, VirtualDir>()
  for (const dir of scan.dirs) rightDirs.set(dir.relPath, { relPath: dir.relPath, isNew: false })

  interface PlacedFile {
    id: string
    name: string
    ext: string
    parentDir: string
    status: 'moved' | 'excluded' | 'unchanged'
    edited: boolean
  }
  const placed: PlacedFile[] = []

  for (const file of scan.files) {
    if (trashedSet.has(file.id)) continue
    const move = moveByFile.get(file.id)
    if (move && move.included) {
      placed.push({
        id: file.id,
        name: file.name,
        ext: file.ext,
        parentDir: move.destFolder,
        status: 'moved',
        edited: move.edited
      })
      if (move.destFolder !== '') {
        for (const anc of [...ancestorsOf(move.destFolder), move.destFolder]) {
          if (!rightDirs.has(anc)) rightDirs.set(anc, { relPath: anc, isNew: !existingDirSet.has(anc) })
        }
      }
    } else {
      placed.push({
        id: file.id,
        name: file.name,
        ext: file.ext,
        parentDir: file.parentDir,
        status: move ? 'excluded' : 'unchanged',
        edited: false
      })
    }
  }

  // Recursive file counts per right-pane dir.
  const rightCounts = new Map<string, number>()
  for (const pf of placed) {
    let dir = pf.parentDir
    while (dir !== '') {
      rightCounts.set(dir, (rightCounts.get(dir) ?? 0) + 1)
      const slash = dir.lastIndexOf('/')
      dir = slash === -1 ? '' : dir.slice(0, slash)
    }
  }

  const rightNodeByDir = new Map<string, TreeNode>()
  const rightRoots: TreeNode[] = []
  for (const vd of rightDirs.values()) {
    rightNodeByDir.set(vd.relPath, {
      id: dirRowId(vd.relPath),
      kind: 'folder',
      name: vd.relPath.split('/').pop()!,
      path: vd.relPath,
      status: vd.isNew ? 'new' : 'default',
      badge: vd.isNew ? 'new' : undefined,
      count: rightCounts.get(vd.relPath) ?? 0,
      children: []
    })
  }
  for (const vd of rightDirs.values()) {
    const node = rightNodeByDir.get(vd.relPath)!
    const parentPath = vd.relPath.includes('/')
      ? vd.relPath.slice(0, vd.relPath.lastIndexOf('/'))
      : ''
    const parent = parentPath === '' ? null : rightNodeByDir.get(parentPath)
    if (parent) parent.children!.push(node)
    else rightRoots.push(node)
  }
  for (const pf of placed) {
    const node: TreeNode = {
      id: `f:${pf.id}`,
      kind: 'file',
      name: pf.name,
      path: pf.id,
      ext: pf.ext,
      status: pf.status,
      badge: dupeFileIds.has(pf.id) ? 'duplicate' : pf.edited ? 'edited' : undefined,
      included: moveByFile.has(pf.id) ? (moveByFile.get(pf.id)!.included ?? true) : undefined
    }
    const parent = pf.parentDir === '' ? null : rightNodeByDir.get(pf.parentDir)
    if (parent) parent.children!.push(node)
    else rightRoots.push(node)
  }
  for (const node of rightNodeByDir.values()) sortNodes(node.children!)
  sortNodes(rightRoots)

  // ---- left pane (current) -------------------------------------------------
  const leftCounts = new Map<string, number>()
  for (const file of scan.files) {
    let dir = file.parentDir
    while (dir !== '') {
      leftCounts.set(dir, (leftCounts.get(dir) ?? 0) + 1)
      const slash = dir.lastIndexOf('/')
      dir = slash === -1 ? '' : dir.slice(0, slash)
    }
  }
  const leftNodeByDir = new Map<string, TreeNode>()
  const leftRoots: TreeNode[] = []
  for (const dir of scan.dirs) {
    leftNodeByDir.set(dir.relPath, {
      id: dirRowId(dir.relPath),
      kind: 'folder',
      name: dir.name,
      path: dir.relPath,
      status: 'default',
      badge: dir.managedByOrdino ? 'managed' : undefined,
      count: leftCounts.get(dir.relPath) ?? 0,
      children: []
    })
  }
  for (const dir of scan.dirs) {
    const node = leftNodeByDir.get(dir.relPath)!
    const parent = dir.parentDir === '' || dir.parentDir === null ? null : leftNodeByDir.get(dir.parentDir)
    if (parent) parent.children!.push(node)
    else leftRoots.push(node)
  }
  for (const file of scan.files) {
    const move = moveByFile.get(file.id)
    const node: TreeNode = {
      id: `f:${file.id}`,
      kind: 'file',
      name: file.name,
      path: file.id,
      ext: file.ext,
      status: trashedSet.has(file.id)
        ? 'trash'
        : move?.included
          ? 'moved-away'
          : organizedSet.has(file.id)
            ? 'unchanged'
            : move
              ? 'unchanged'
              : 'unchanged',
      badge: dupeFileIds.has(file.id) ? 'duplicate' : undefined
    }
    const parent = file.parentDir === '' ? null : leftNodeByDir.get(file.parentDir)
    if (parent) parent.children!.push(node)
    else leftRoots.push(node)
  }
  for (const node of leftNodeByDir.values()) sortNodes(node.children!)
  sortNodes(leftRoots)

  // ---- expansion defaults & stats ------------------------------------------
  const defaultExpandedRight = new Set<string>()
  const defaultExpandedLeft = new Set<string>()
  for (const move of moves) {
    if (!move.included) continue
    if (move.destFolder !== '') {
      for (const p of [...ancestorsOf(move.destFolder), move.destFolder]) {
        defaultExpandedRight.add(dirRowId(p))
      }
    }
    const sourceDir = move.source.includes('/')
      ? move.source.slice(0, move.source.lastIndexOf('/'))
      : ''
    if (sourceDir !== '') {
      for (const p of [...ancestorsOf(sourceDir), sourceDir]) defaultExpandedLeft.add(dirRowId(p))
    }
  }

  const included = moves.filter((m) => m.included)
  const stats: ReviewStats = {
    includedMoves: included.length,
    targetFolders: new Set(included.map((m) => m.destFolder)).size,
    newFolderCount: [...rightDirs.values()].filter(
      (d) => d.isNew && (rightCounts.get(d.relPath) ?? 0) > 0
    ).length,
    excluded: moves.filter((m) => !m.included && dupeChoices[m.fileId] !== 'trash').length,
    duplicateGroups: plan.duplicateGroups.length,
    trashed: trashedFileIds.length
  }

  const reassignTargets = [...new Set([...rightDirs.keys(), ...plan.newFolders])]
    .filter((p) => p !== '')
    .sort()

  return {
    left: leftRoots,
    right: rightRoots,
    stats,
    trashedFileIds,
    defaultExpandedLeft,
    defaultExpandedRight,
    reassignTargets
  }
}
