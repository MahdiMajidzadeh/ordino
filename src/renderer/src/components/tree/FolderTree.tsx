import { useEffect, useRef, type ReactNode } from 'react'
import { useVirtualizer, type Virtualizer } from '@tanstack/react-virtual'
import type { FlatRow } from '../../lib/tree'
import type { CheckState } from '../../lib/inclusion'
import { TreeRow, type TreeMode } from './TreeRow'
import { ROW_HEIGHT } from './constants'

export interface FolderTreeHandles {
  virtualizer: Virtualizer<HTMLDivElement, Element>
  scrollElement: HTMLDivElement | null
}

export interface FolderTreeProps {
  rows: FlatRow[]
  mode: TreeMode
  expanded: ReadonlySet<string>
  onToggleExpand: (id: string) => void
  checkState?: (row: FlatRow) => CheckState
  onCheck?: (row: FlatRow, next: boolean) => void
  onToggleInclude?: (row: FlatRow, next: boolean) => void
  onHoverRow?: (row: FlatRow | null) => void
  onSelectRow?: (row: FlatRow) => void
  hoveredRowId?: string | null
  selectedRowId?: string | null
  focusedRowId?: string | null
  trailing?: (row: FlatRow) => ReactNode
  /** Exposes the virtualizer + scroll element (connector overlay, scroll sync). */
  onHandles?: (handles: FolderTreeHandles) => void
  /** Called on every scroll (rAF-throttled by the browser's scroll events). */
  onScroll?: () => void
  className?: string
  ariaLabel?: string
}

/**
 * The shared virtualized tree (always virtualized — at 20 rows the
 * virtualizer is free, and one code path beats two). Fixed ROW_HEIGHT rows;
 * see constants.ts for why that's structural.
 */
export function FolderTree({
  rows,
  mode,
  expanded,
  onToggleExpand,
  checkState,
  onCheck,
  onToggleInclude,
  onHoverRow,
  onSelectRow,
  hoveredRowId,
  selectedRowId,
  focusedRowId,
  trailing,
  onHandles,
  onScroll,
  className = '',
  ariaLabel
}: FolderTreeProps): React.JSX.Element {
  const scrollRef = useRef<HTMLDivElement>(null)

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12
  })

  useEffect(() => {
    onHandles?.({ virtualizer, scrollElement: scrollRef.current })
  }, [onHandles, virtualizer])

  return (
    <div
      ref={scrollRef}
      role="tree"
      aria-label={ariaLabel}
      onScroll={onScroll}
      className={`overflow-y-auto overflow-x-hidden ${className}`}
    >
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const row = rows[vi.index]
          return (
            <div
              key={row.id}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${vi.start}px)`
              }}
            >
              <TreeRow
                row={row}
                mode={mode}
                expanded={expanded.has(row.id)}
                isSelected={selectedRowId === row.id}
                isHovered={hoveredRowId === row.id}
                isFocused={focusedRowId === row.id}
                checkState={checkState?.(row)}
                onToggleExpand={onToggleExpand}
                onCheck={onCheck}
                onToggleInclude={onToggleInclude}
                onHover={onHoverRow}
                onSelect={onSelectRow}
                trailing={trailing?.(row)}
              />
            </div>
          )
        })}
      </div>
    </div>
  )
}
