import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ChevronRight, Trash2, Undo2 } from 'lucide-react'
import type { HistoryDetail, HistoryEntry } from '@shared/types'
import { ordino } from '../../api/client'
import { useApp } from '../../stores'
import { Button } from '../../components/ui/Button'
import { formatWhen } from '../../lib/format'

export function HistoryScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const undoRunning = useApp((s) => s.undoRunning)
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [detail, setDetail] = useState<HistoryDetail | null>(null)

  const reload = async (): Promise<void> => {
    const res = await ordino.invoke('history:list', undefined)
    if (res.ok) setEntries(res.data)
  }

  useEffect(() => {
    void reload()
  }, [])

  const toggleDetail = async (entry: HistoryEntry): Promise<void> => {
    if (openId === entry.id) {
      setOpenId(null)
      setDetail(null)
      return
    }
    setOpenId(entry.id)
    setDetail(null)
    const res = await ordino.invoke('history:get', {
      rootPath: entry.rootPath,
      operationId: entry.id
    })
    if (res.ok) setDetail(res.data)
  }

  const undoEntry = async (entry: HistoryEntry): Promise<void> => {
    const res = await ordino.invoke('undo:last', { rootPath: entry.rootPath })
    if (res.ok) void reload()
  }

  return (
    <div className="mx-auto h-full max-w-2xl space-y-4 overflow-y-auto p-8">
      <h1 className="text-[22px] font-semibold tracking-tight">{t('history.title')}</h1>

      {entries !== null && entries.length === 0 && (
        <p className="text-sm text-ink-secondary">{t('history.empty')}</p>
      )}

      <ul className="space-y-2">
        {(entries ?? []).map((entry) => (
          <li key={entry.id} className="rounded-xl border border-line bg-surface-1">
            <button
              type="button"
              onClick={() => void toggleDetail(entry)}
              aria-expanded={openId === entry.id}
              className="flex w-full items-center gap-3 px-4 py-3 text-start"
            >
              <ChevronRight
                size={14}
                className={`shrink-0 text-ink-faint transition-transform ${openId === entry.id ? 'rotate-90' : ''}`}
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{entry.rootName}</span>
                  <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] text-ink-secondary">
                    {t(`strategy.${entry.strategy.id}.name`)}
                  </span>
                  {entry.undoable && entry.status !== 'undone' && (
                    <span className="rounded bg-accent-soft px-1.5 py-px text-[10px] text-accent">
                      {t('history.undoableBadge')}
                    </span>
                  )}
                  {entry.status === 'undone' && (
                    <span className="rounded bg-surface-2 px-1.5 py-px text-[10px] text-ink-faint line-through">
                      {t('history.undoneBadge')}
                    </span>
                  )}
                  {entry.status === 'pending' && (
                    <span className="rounded bg-dupe-soft px-1.5 py-px text-[10px] text-dupe">
                      {t('history.pendingBadge')}
                    </span>
                  )}
                </span>
                <span className="mt-0.5 block truncate text-xs text-ink-faint">
                  {formatWhen(entry.appliedAt)} · {t('history.entrySummary', { moved: entry.moved, trashed: entry.trashed })}
                </span>
              </span>
              {entry.undoable && entry.status !== 'undone' && (
                <Button
                  size="sm"
                  disabled={undoRunning}
                  onClick={(e) => {
                    e.stopPropagation()
                    void undoEntry(entry)
                  }}
                >
                  <Undo2 size={12} aria-hidden />
                  {t('common.undo')}
                </Button>
              )}
            </button>

            {openId === entry.id && detail && (
              <div className="max-h-64 overflow-y-auto border-t border-line px-4 py-3">
                <ul className="space-y-1 text-xs text-ink-secondary">
                  {detail.ops.map((op, i) => (
                    <li key={i} className="flex items-center gap-1.5">
                      {op.kind === 'trash' ? (
                        <>
                          <Trash2 size={11} className="shrink-0 text-dupe" aria-hidden />
                          <span className="truncate">{op.from}</span>
                        </>
                      ) : (
                        <>
                          <span className="truncate">{op.from}</span>
                          <ArrowRight size={11} className="shrink-0 text-accent" aria-hidden />
                          <span className="truncate">{op.to}</span>
                        </>
                      )}
                      <span className="ms-auto shrink-0 text-[10px] text-ink-faint">{op.status}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
