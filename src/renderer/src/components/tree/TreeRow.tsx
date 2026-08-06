import { memo } from 'react'
import { ChevronRight, Folder, FolderPlus } from 'lucide-react'
import type { FlatRow } from '../../lib/tree'
import { iconForFile } from '../../lib/fileIcons'
import { Checkbox } from '../ui/Checkbox'
import type { CheckState } from '../../lib/inclusion'
import { ROW_HEIGHT } from './constants'

export type TreeMode = 'inclusion' | 'current' | 'proposed'

export interface TreeRowProps {
  row: FlatRow
  mode: TreeMode
  expanded: boolean
  isSelected: boolean
  isHovered: boolean
  isFocused: boolean
  checkState?: CheckState
  onToggleExpand: (id: string) => void
  onCheck?: (row: FlatRow, next: boolean) => void
  onToggleInclude?: (row: FlatRow, next: boolean) => void
  onHover?: (row: FlatRow | null) => void
  onSelect?: (row: FlatRow) => void
  /** Extra trailing content (badges, counts, actions) per mode. */
  trailing?: React.ReactNode
}

function statusClasses(row: FlatRow): string {
  switch (row.status) {
    case 'unchanged':
    case 'excluded':
      return 'opacity-55'
    case 'moved-away':
      return 'opacity-60'
    case 'trash':
      return 'opacity-70 line-through decoration-dupe'
    default:
      return ''
  }
}

export const TreeRow = memo(function TreeRow({
  row,
  mode,
  expanded,
  isSelected,
  isHovered,
  isFocused,
  checkState,
  onToggleExpand,
  onCheck,
  onToggleInclude,
  onHover,
  onSelect,
  trailing
}: TreeRowProps): React.JSX.Element {
  const isFolder = row.kind === 'folder'
  const FileIcon = isFolder ? null : iconForFile(row.ext, false)

  return (
    <div
      role="treeitem"
      aria-level={row.depth + 1}
      aria-expanded={row.hasChildren ? expanded : undefined}
      aria-selected={isSelected}
      data-row-id={row.id}
      onMouseEnter={onHover ? () => onHover(row) : undefined}
      onMouseLeave={onHover ? () => onHover(null) : undefined}
      onClick={onSelect ? () => onSelect(row) : undefined}
      className={`relative flex cursor-default items-center gap-1.5 px-2 text-[13px] ${statusClasses(row)} ${
        isSelected
      ? 'bg-accent-soft'
      : isHovered
        ? 'bg-surface-2'
        : ''
      } ${isFocused ? 'ring-1 ring-accent ring-inset' : ''} ${row.status === 'moved' ? 'bg-accent-soft/40' : ''} ${
        row.status === 'new' && isFolder ? 'bg-new-soft/40' : ''
      }`}
      style={{ height: ROW_HEIGHT, paddingInlineStart: 8 + row.depth * 16 }}
    >
      {/* Accent edge for move sources/destinations */}
      {(row.status === 'moved' || row.status === 'moved-away') && (
        <span className="absolute inset-y-1 start-0 w-0.5 rounded-full bg-accent" aria-hidden />
      )}

      {row.hasChildren ? (
        <button
          type="button"
          aria-label={expanded ? 'Collapse' : 'Expand'}
          onClick={(e) => {
            e.stopPropagation()
            onToggleExpand(row.id)
          }}
          className="flex size-4 shrink-0 items-center justify-center rounded text-ink-faint hover:text-ink"
        >
          <ChevronRight
            size={13}
            className={`transition-transform duration-150 ${expanded ? 'rotate-90' : ''}`}
            aria-hidden
          />
        </button>
      ) : (
        <span className="size-4 shrink-0" aria-hidden />
      )}

      {mode === 'inclusion' && isFolder && checkState && onCheck && (
        <Checkbox state={checkState} onChange={(next) => onCheck(row, next)} label={row.name} />
      )}
      {mode === 'proposed' && !isFolder && row.included !== undefined && onToggleInclude && (
        <Checkbox
          state={row.included ? 'checked' : 'unchecked'}
          onChange={(next) => onToggleInclude(row, next)}
          label={row.name}
        />
      )}

      {isFolder ? (
        row.status === 'new' ? (
          <FolderPlus size={15} className="shrink-0 text-new" aria-hidden />
        ) : (
          <Folder size={15} className="shrink-0 text-ink-faint" aria-hidden />
        )
      ) : (
        FileIcon && <FileIcon.Icon size={15} className={`shrink-0 ${FileIcon.colorClass}`} aria-hidden />
      )}

      <span className={`min-w-0 flex-1 truncate ${row.status === 'new' && isFolder ? 'text-new' : ''}`}>
        {row.name}
      </span>

      {row.badge === 'duplicate' && <span className="size-1.5 shrink-0 rounded-full bg-dupe" aria-hidden />}
      {trailing}
      {isFolder && row.count !== undefined && (
        <span className="shrink-0 text-[11px] tabular-nums text-ink-faint">{row.count}</span>
      )}
    </div>
  )
})
