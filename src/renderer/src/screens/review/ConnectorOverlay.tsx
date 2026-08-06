import { useMemo } from 'react'
import type { FlatRow } from '../../lib/tree'
import type { EffectiveMove } from '../../stores/planSlice'
import { ROW_HEIGHT } from '../../components/tree/constants'

/**
 * SVG connector lines between the two panes (§5.5). Geometry comes from
 * virtualizer math — index * ROW_HEIGHT - scrollTop — never DOM row reads, so
 * endpoints exist even for rows virtualized out of the DOM. Line policy: one
 * hover line, one selection line, ≤ MAX_GROUP_LINES for a selected folder
 * (never all lines at once).
 */
const MAX_GROUP_LINES = 12
const EDGE_PAD = 8

export interface PaneGeometry {
  /** Scroll container of the pane's FolderTree. */
  scrollElement: HTMLDivElement | null
  rows: FlatRow[]
  rowIndex: Map<string, number>
}

export interface ConnectorOverlayProps {
  container: HTMLDivElement | null
  left: PaneGeometry
  right: PaneGeometry
  moves: EffectiveMove[]
  hoveredFileId: string | null
  selectedRowId: string | null
  /** Bumped by scroll/resize listeners to force geometry recompute. */
  tick: number
}

interface Line {
  key: string
  x1: number
  y1: number
  x2: number
  y2: number
  clamped1: boolean
  clamped2: boolean
  emphasis: 'hover' | 'selected' | 'group'
}

interface Endpoint {
  y: number
  clamped: boolean
}

function ancestorRowIds(path: string): string[] {
  // Deepest-first ancestor dir row ids for a rel path.
  const out: string[] = []
  let idx = path.lastIndexOf('/')
  while (idx > 0) {
    out.push(`d:${path.slice(0, idx)}`)
    idx = path.lastIndexOf('/', idx - 1)
  }
  return out
}

/** Y-center of a row (or its nearest visible ancestor), overlay-relative. */
function endpointFor(
  pane: PaneGeometry,
  containerRect: DOMRect,
  rowId: string,
  fallbackAncestorsOf: string
): Endpoint | null {
  const el = pane.scrollElement
  if (!el) return null
  let index = pane.rowIndex.get(rowId)
  if (index === undefined) {
    for (const anc of ancestorRowIds(fallbackAncestorsOf)) {
      const i = pane.rowIndex.get(anc)
      if (i !== undefined) {
        index = i
        break
      }
    }
  }
  if (index === undefined) return null
  const rect = el.getBoundingClientRect()
  const rawY = rect.top - containerRect.top + index * ROW_HEIGHT - el.scrollTop + ROW_HEIGHT / 2
  const minY = rect.top - containerRect.top + EDGE_PAD
  const maxY = rect.bottom - containerRect.top - EDGE_PAD
  const y = Math.max(minY, Math.min(maxY, rawY))
  return { y, clamped: y !== rawY }
}

export function ConnectorOverlay({
  container,
  left,
  right,
  moves,
  hoveredFileId,
  selectedRowId,
  tick
}: ConnectorOverlayProps): React.JSX.Element | null {
  const geometry = useMemo((): { lines: Line[]; overflow: number } => {
    void tick
    if (!container || !left.scrollElement || !right.scrollElement) return { lines: [], overflow: 0 }
    const containerRect = container.getBoundingClientRect()
    const leftRect = left.scrollElement.getBoundingClientRect()
    const rightRect = right.scrollElement.getBoundingClientRect()
    const x1 = leftRect.right - containerRect.left
    const x2 = rightRect.left - containerRect.left

    const moveByFile = new Map(moves.map((m) => [m.fileId, m]))
    const lines: Line[] = []
    let overflow = 0

    const lineForFile = (fileId: string, emphasis: Line['emphasis']): Line | null => {
      const move = moveByFile.get(fileId)
      if (!move || !move.included) return null
      const from = endpointFor(left, containerRect, `f:${fileId}`, move.source)
      const toRowId = `f:${fileId}`
      const to =
        endpointFor(right, containerRect, toRowId, `${move.destFolder}/x`) ??
        endpointFor(right, containerRect, `d:${move.destFolder}`, `${move.destFolder}/x`)
      if (!from || !to) return null
      return {
        key: `${emphasis}:${fileId}`,
        x1,
        y1: from.y,
        x2,
        y2: to.y,
        clamped1: from.clamped,
        clamped2: to.clamped,
        emphasis
      }
    }

    if (selectedRowId?.startsWith('f:')) {
      const line = lineForFile(selectedRowId.slice(2), 'selected')
      if (line) lines.push(line)
    } else if (selectedRowId?.startsWith('d:')) {
      const folder = selectedRowId.slice(2)
      const targeting = moves.filter((m) => m.included && m.destFolder === folder)
      const shown = targeting.slice(0, MAX_GROUP_LINES)
      overflow = targeting.length - shown.length
      const to = endpointFor(right, containerRect, selectedRowId, `${folder}/x`)
      if (to) {
        for (const move of shown) {
          const from = endpointFor(left, containerRect, `f:${move.fileId}`, move.source)
          if (from) {
            lines.push({
              key: `group:${move.fileId}`,
              x1,
              y1: from.y,
              x2,
              y2: to.y,
              clamped1: from.clamped,
              clamped2: to.clamped,
              emphasis: 'group'
            })
          }
        }
      }
    }

    if (hoveredFileId && `f:${hoveredFileId}` !== selectedRowId) {
      const line = lineForFile(hoveredFileId, 'hover')
      if (line) lines.push(line)
    }

    return { lines, overflow }
  }, [container, left, right, moves, hoveredFileId, selectedRowId, tick])

  if (geometry.lines.length === 0) return null

  return (
    <svg
      className="pointer-events-none absolute inset-0 z-10 h-full w-full overflow-visible"
      aria-hidden
    >
      <defs>
        <marker
          id="ord-arrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto-start-reverse"
        >
          <path d="M0,0.8 L7.2,4 L0,7.2 Z" fill="var(--ord-accent)" />
        </marker>
      </defs>
      {geometry.lines.map((line) => {
        const bend = Math.min(48, Math.max(24, Math.abs(line.x2 - line.x1) / 2))
        return (
          <g key={line.key}>
            <path
              d={`M ${line.x1} ${line.y1} C ${line.x1 + bend} ${line.y1}, ${line.x2 - bend} ${line.y2}, ${line.x2} ${line.y2}`}
              fill="none"
              stroke="var(--ord-accent)"
              strokeWidth={line.emphasis === 'group' ? 1.25 : 1.75}
              strokeOpacity={line.emphasis === 'hover' ? 0.85 : line.emphasis === 'group' ? 0.5 : 1}
              strokeDasharray={line.clamped1 || line.clamped2 ? '4 3' : undefined}
              markerEnd={line.clamped2 ? undefined : 'url(#ord-arrow)'}
            />
            <circle cx={line.x1} cy={line.y1} r="2.5" fill="var(--ord-accent)" />
            {line.clamped2 && (
              <text
                x={line.x2 - 4}
                y={line.y2 + 4}
                textAnchor="end"
                fontSize="10"
                fill="var(--ord-accent)"
              >
                {line.y2 <= EDGE_PAD + 20 ? '↑' : '↓'}
              </text>
            )}
          </g>
        )
      })}
      {geometry.overflow > 0 && (
        <text
          x="50%"
          y="97%"
          textAnchor="middle"
          fontSize="11"
          fill="var(--ord-text-secondary)"
        >
          +{geometry.overflow}
        </text>
      )}
    </svg>
  )
}
