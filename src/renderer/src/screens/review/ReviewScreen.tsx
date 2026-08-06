import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ListCollapse, ListTree, Trash2, X } from 'lucide-react'
import { useApp } from '../../stores'
import { effectiveMovesOf } from '../../stores/planSlice'
import { buildReviewTrees } from '../../lib/reviewTrees'
import { flattenTree, type FlatRow } from '../../lib/tree'
import { FolderTree, type FolderTreeHandles } from '../../components/tree/FolderTree'
import { Kbd } from '../../components/ui/Kbd'
import { Button } from '../../components/ui/Button'
import { ConnectorOverlay } from './ConnectorOverlay'
import { FileDetailPopover, type DetailAnchor } from './FileDetailPopover'
import { DuplicatesSection } from './DuplicatesSection'
import { SummaryBar } from './SummaryBar'

export function ReviewScreen(): React.JSX.Element | null {
  const { t } = useTranslation()
  const scan = useApp((s) => s.scanResult)
  const plan = useApp((s) => s.plan)
  const decisions = useApp((s) => s.decisions)
  const dupeChoices = useApp((s) => s.dupeChoices)
  const hoveredFileId = useApp((s) => s.hoveredFileId)
  const selectedRowId = useApp((s) => s.selectedRowId)
  const focusedRowId = useApp((s) => s.focusedRowId)
  const expandedLeft = useApp((s) => s.expandedLeft)
  const expandedRight = useApp((s) => s.expandedRight)
  const reviewExpansionInitialized = useApp((s) => s.reviewExpansionInitialized)

  const setHoveredFileId = useApp((s) => s.setHoveredFileId)
  const setSelectedRowId = useApp((s) => s.setSelectedRowId)
  const setFocusedRowId = useApp((s) => s.setFocusedRowId)
  const toggleExpandLeft = useApp((s) => s.toggleExpandLeft)
  const toggleExpandRight = useApp((s) => s.toggleExpandRight)
  const setExpandedRight = useApp((s) => s.setExpandedRight)
  const initReviewExpansion = useApp((s) => s.initReviewExpansion)
  const toggleMoveIncluded = useApp((s) => s.toggleMoveIncluded)
  const setFolderApproval = useApp((s) => s.setFolderApproval)
  const setDupeChoice = useApp((s) => s.setDupeChoice)

  const containerRef = useRef<HTMLDivElement>(null)
  const [leftHandles, setLeftHandles] = useState<FolderTreeHandles | null>(null)
  const [rightHandles, setRightHandles] = useState<FolderTreeHandles | null>(null)
  const [tick, setTick] = useState(0)
  const [detail, setDetail] = useState<DetailAnchor | null>(null)

  const moves = useMemo(
    () => (plan ? effectiveMovesOf(plan, decisions, dupeChoices) : []),
    [plan, decisions, dupeChoices]
  )
  const trees = useMemo(
    () => (plan && scan ? buildReviewTrees(scan, plan, moves, dupeChoices) : null),
    [plan, scan, moves, dupeChoices]
  )

  // Default expansion once per plan.
  useEffect(() => {
    if (trees && !reviewExpansionInitialized) {
      initReviewExpansion(trees.defaultExpandedLeft, trees.defaultExpandedRight)
    }
  }, [trees, reviewExpansionInitialized, initReviewExpansion])

  const leftRows = useMemo(() => (trees ? flattenTree(trees.left, expandedLeft) : []), [trees, expandedLeft])
  const rightRows = useMemo(
    () => (trees ? flattenTree(trees.right, expandedRight) : []),
    [trees, expandedRight]
  )
  const leftIndex = useMemo(() => new Map(leftRows.map((r, i) => [r.id, i])), [leftRows])
  const rightIndex = useMemo(() => new Map(rightRows.map((r, i) => [r.id, i])), [rightRows])

  const bumpTick = useCallback((): void => {
    requestAnimationFrame(() => setTick((v) => v + 1))
  }, [])

  useEffect(() => {
    if (!containerRef.current) return
    const observer = new ResizeObserver(bumpTick)
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [bumpTick])

  // Cross-pane sync: selecting a file scrolls the counterpart into view.
  const revealInPane = useCallback(
    (handles: FolderTreeHandles | null, index: Map<string, number>, rowId: string): void => {
      const i = index.get(rowId)
      if (i !== undefined && handles) handles.virtualizer.scrollToIndex(i, { align: 'center' })
    },
    []
  )

  const onSelectRow = useCallback(
    (row: FlatRow, pane: 'left' | 'right', e?: { rect: DOMRect }): void => {
      setSelectedRowId(row.id)
      setFocusedRowId(row.id)
      if (row.kind === 'file') {
        if (e) setDetail({ fileId: row.path, rect: e.rect })
        // Reveal counterpart in the other pane.
        if (pane === 'left') revealInPane(rightHandles, rightIndex, row.id)
        else revealInPane(leftHandles, leftIndex, row.id)
        bumpTick()
      }
    },
    [setSelectedRowId, setFocusedRowId, revealInPane, rightHandles, rightIndex, leftHandles, leftIndex, bumpTick]
  )

  // Keyboard navigation (P1-5) over the right pane's rows.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT') return
      if (rightRows.length === 0) return

      const currentIdx = focusedRowId ? (rightIndex.get(focusedRowId) ?? -1) : -1
      const moveFocus = (next: number): void => {
        const clamped = Math.max(0, Math.min(rightRows.length - 1, next))
        const row = rightRows[clamped]
        setFocusedRowId(row.id)
        rightHandles?.virtualizer.scrollToIndex(clamped, { align: 'auto' })
        bumpTick()
      }

      switch (e.key) {
        case 'j':
        case 'ArrowDown':
          e.preventDefault()
          moveFocus(currentIdx + 1)
          break
        case 'k':
        case 'ArrowUp':
          e.preventDefault()
          moveFocus(currentIdx <= 0 ? 0 : currentIdx - 1)
          break
        case ' ': {
          e.preventDefault()
          const row = focusedRowId ? rightRows[rightIndex.get(focusedRowId) ?? -1] : undefined
          if (!row) break
          if (row.kind === 'file' && row.included !== undefined) {
            toggleMoveIncluded(row.path, !row.included)
          } else if (row.kind === 'folder') {
            const anyIncluded = moves.some((m) => m.included && m.destFolder === row.path)
            setFolderApproval(row.path, !anyIncluded)
          }
          break
        }
        case 'Enter': {
          const row = focusedRowId ? rightRows[rightIndex.get(focusedRowId) ?? -1] : undefined
          if (row?.kind === 'file') {
            const el = rightHandles?.scrollElement?.querySelector(`[data-row-id="${CSS.escape(row.id)}"]`)
            const rect = el?.getBoundingClientRect()
            if (rect) setDetail({ fileId: row.path, rect })
            setSelectedRowId(row.id)
          }
          break
        }
        case 'ArrowRight':
        case 'ArrowLeft': {
          const row = focusedRowId ? rightRows[rightIndex.get(focusedRowId) ?? -1] : undefined
          if (row?.kind === 'folder' && row.hasChildren) {
            const isExpanded = expandedRight.has(row.id)
            if ((e.key === 'ArrowRight' && !isExpanded) || (e.key === 'ArrowLeft' && isExpanded)) {
              e.preventDefault()
              toggleExpandRight(row.id)
            }
          }
          break
        }
        case 'x': {
          const row = focusedRowId ? rightRows[rightIndex.get(focusedRowId) ?? -1] : undefined
          if (row?.kind === 'file' && row.badge === 'duplicate') {
            const current = dupeChoices[row.path] ?? 'keep'
            setDupeChoice(row.path, current === 'keep' ? 'trash' : 'keep')
          }
          break
        }
        case 'Escape':
          setDetail(null)
          setSelectedRowId(null)
          bumpTick()
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [
    rightRows,
    rightIndex,
    focusedRowId,
    expandedRight,
    moves,
    dupeChoices,
    rightHandles,
    setFocusedRowId,
    setSelectedRowId,
    toggleMoveIncluded,
    setFolderApproval,
    setDupeChoice,
    toggleExpandRight,
    bumpTick
  ])

  const expandAllChanges = useCallback((): void => {
    if (trees) setExpandedRight(trees.defaultExpandedRight)
  }, [trees, setExpandedRight])
  const collapseAll = useCallback((): void => setExpandedRight(new Set()), [setExpandedRight])

  if (!plan || !scan || !trees) return null

  const folderGroupActions = (row: FlatRow): React.ReactNode => {
    if (row.kind !== 'folder') return null
    const targeting = moves.filter((m) => m.destFolder === row.path)
    if (targeting.length === 0) return null
    const includedCount = targeting.filter((m) => m.included).length
    return (
      <span className="hidden items-center gap-0.5 group-hover:flex">
        <button
          type="button"
          title={t('review.approveAll', { count: targeting.length })}
          aria-label={t('review.approveAll', { count: targeting.length })}
          onClick={(e) => {
            e.stopPropagation()
            setFolderApproval(row.path, true)
          }}
          className={`rounded p-0.5 hover:bg-surface-2 ${includedCount === targeting.length ? 'text-new' : 'text-ink-faint'}`}
        >
          <Check size={12} aria-hidden />
        </button>
        <button
          type="button"
          title={t('review.rejectAll', { count: targeting.length })}
          aria-label={t('review.rejectAll', { count: targeting.length })}
          onClick={(e) => {
            e.stopPropagation()
            setFolderApproval(row.path, false)
          }}
          className={`rounded p-0.5 hover:bg-surface-2 ${includedCount === 0 ? 'text-danger' : 'text-ink-faint'}`}
        >
          <X size={12} aria-hidden />
        </button>
      </span>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex shrink-0 items-center justify-between px-4 py-2.5">
        <h1 className="text-base font-semibold tracking-tight">{t('review.title')}</h1>
        <div className="flex items-center gap-3">
          <span className="hidden items-center gap-1 text-[11px] text-ink-faint lg:flex">
            <Kbd>j</Kbd>
            <Kbd>k</Kbd>
            <Kbd>space</Kbd>
            {t('review.keyboardHint')}
          </span>
          <Button size="sm" variant="ghost" onClick={expandAllChanges}>
            <ListTree size={13} aria-hidden />
            {t('review.expandChanges')}
          </Button>
          <Button size="sm" variant="ghost" onClick={collapseAll}>
            <ListCollapse size={13} aria-hidden />
            {t('review.collapseAll')}
          </Button>
        </div>
      </header>

      {plan.moves.length === 0 && (
        <div className="px-4 pb-2 text-sm text-ink-secondary">{t('review.zeroMoves')}</div>
      )}

      <div
        ref={containerRef}
        className="relative grid min-h-0 flex-1 grid-cols-[1fr_56px_1fr] px-4 pb-2"
      >
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
          <div className="border-b border-line px-3 py-1.5 text-xs font-medium text-ink-faint uppercase tracking-wide">
            {t('review.currentPane')}
          </div>
          <FolderTree
            rows={leftRows}
            mode="current"
            expanded={expandedLeft}
            onToggleExpand={(id) => {
              toggleExpandLeft(id)
              bumpTick()
            }}
            onHoverRow={(row) => {
              setHoveredFileId(row?.kind === 'file' ? row.path : null)
              bumpTick()
            }}
            onSelectRow={(row) => {
              const el = leftHandles?.scrollElement?.querySelector(
                `[data-row-id="${CSS.escape(row.id)}"]`
              )
              onSelectRow(row, 'left', el ? { rect: el.getBoundingClientRect() } : undefined)
            }}
            hoveredRowId={hoveredFileId ? `f:${hoveredFileId}` : null}
            selectedRowId={selectedRowId}
            onHandles={setLeftHandles}
            onScroll={bumpTick}
            className="flex-1 py-1"
            ariaLabel={t('review.currentPane')}
          />
        </section>

        <div aria-hidden />

        <section className="group flex min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-surface-1">
          <div className="border-b border-line px-3 py-1.5 text-xs font-medium text-ink-faint uppercase tracking-wide">
            {t('review.proposedPane')}
          </div>
          <FolderTree
            rows={rightRows}
            mode="proposed"
            expanded={expandedRight}
            onToggleExpand={(id) => {
              toggleExpandRight(id)
              bumpTick()
            }}
            onToggleInclude={(row, next) => toggleMoveIncluded(row.path, next)}
            onHoverRow={(row) => {
              setHoveredFileId(row?.kind === 'file' ? row.path : null)
              bumpTick()
            }}
            onSelectRow={(row) => {
              const el = rightHandles?.scrollElement?.querySelector(
                `[data-row-id="${CSS.escape(row.id)}"]`
              )
              onSelectRow(row, 'right', el ? { rect: el.getBoundingClientRect() } : undefined)
            }}
            hoveredRowId={hoveredFileId ? `f:${hoveredFileId}` : null}
            selectedRowId={selectedRowId}
            focusedRowId={focusedRowId}
            trailing={folderGroupActions}
            onHandles={setRightHandles}
            onScroll={bumpTick}
            className="flex-1 py-1"
            ariaLabel={t('review.proposedPane')}
          />
          {trees.trashedFileIds.length > 0 && (
            <div className="flex items-center gap-1.5 border-t border-line px-3 py-1.5 text-xs text-dupe">
              <Trash2 size={12} aria-hidden />
              {t('review.duplicates.trashGhost', { count: trees.trashedFileIds.length })}
            </div>
          )}
        </section>

        <ConnectorOverlay
          container={containerRef.current}
          left={{ scrollElement: leftHandles?.scrollElement ?? null, rows: leftRows, rowIndex: leftIndex }}
          right={{
            scrollElement: rightHandles?.scrollElement ?? null,
            rows: rightRows,
            rowIndex: rightIndex
          }}
          moves={moves}
          hoveredFileId={hoveredFileId}
          selectedRowId={selectedRowId}
          tick={tick}
        />
      </div>

      <DuplicatesSection plan={plan} scan={scan} />
      <SummaryBar stats={trees.stats} />

      {detail && (
        <FileDetailPopover
          anchor={detail}
          plan={plan}
          move={moves.find((m) => m.fileId === detail.fileId)}
          reassignTargets={trees.reassignTargets}
          onClose={() => setDetail(null)}
        />
      )}
    </div>
  )
}
