import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, Copy, Sparkles } from 'lucide-react'
import type { Plan, ScanResult } from '@shared/types'
import { useApp } from '../../stores'
import { formatSize } from '../../lib/format'
import { Banner } from '../../components/ui/Banner'

export interface DuplicatesSectionProps {
  plan: Plan
  scan: ScanResult
}

/**
 * Duplicate groups (P0-8): recommended keeper pre-badged, per-file Keep/Trash
 * with Keep as the universal default; "Trash the others" per group; warning
 * when a whole group is marked for trash.
 */
export function DuplicatesSection({ plan, scan }: DuplicatesSectionProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const dupeChoices = useApp((s) => s.dupeChoices)
  const setDupeChoice = useApp((s) => s.setDupeChoice)
  const [open, setOpen] = useState(false)

  if (plan.duplicateGroups.length === 0) return null

  const fileById = new Map(scan.files.map((f) => [f.id, f]))

  return (
    <section className="shrink-0 border-t border-line bg-surface-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-4 py-2 text-sm hover:bg-surface-2"
      >
        <ChevronRight
          size={14}
          className={`text-ink-faint transition-transform ${open ? 'rotate-90' : ''}`}
          aria-hidden
        />
        <Copy size={14} className="text-dupe" aria-hidden />
        <span className="font-medium">
          {t('review.duplicates.title', { count: plan.duplicateGroups.length })}
        </span>
      </button>

      {open && (
        <div className="max-h-60 space-y-3 overflow-y-auto px-4 pb-4">
          {plan.duplicateGroups.map((group) => {
            const allTrashed = group.fileIds.every((id) => dupeChoices[id] === 'trash')
            return (
              <div key={group.id} className="rounded-lg border border-line bg-surface-0 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs text-ink-secondary">
                    {t('review.duplicates.groupSummary', {
                      count: group.fileIds.length,
                      size: formatSize(group.size, t)
                    })}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      for (const id of group.fileIds) {
                        setDupeChoice(id, id === group.recommendedKeeperId ? 'keep' : 'trash')
                      }
                    }}
                    className="text-xs text-accent hover:underline"
                  >
                    {t('review.duplicates.trashOthers')}
                  </button>
                </div>

                <ul className="space-y-1">
                  {group.fileIds.map((fileId) => {
                    const file = fileById.get(fileId)
                    const isKeeper = fileId === group.recommendedKeeperId
                    const choice = dupeChoices[fileId] ?? 'keep'
                    return (
                      <li key={fileId} className="flex items-center gap-2 text-xs">
                        <span className="min-w-0 flex-1 truncate">
                          {file?.relPath ?? fileId}
                          {isKeeper && (
                            <span
                              className="ms-2 inline-flex items-center gap-0.5 rounded bg-new-soft px-1 py-px text-[10px] text-new"
                              title={t(`review.duplicates.keeperReason.${group.keeperReasonCode}`)}
                            >
                              <Sparkles size={9} aria-hidden />
                              {t('review.duplicates.recommended')}
                            </span>
                          )}
                        </span>
                        <div className="flex shrink-0 overflow-hidden rounded-md border border-line">
                          {(['keep', 'trash'] as const).map((c) => (
                            <button
                              key={c}
                              type="button"
                              aria-pressed={choice === c}
                              onClick={() => setDupeChoice(fileId, c)}
                              className={`px-2 py-1 ${
                                choice === c
                                  ? c === 'trash'
                                    ? 'bg-dupe-soft text-dupe'
                                    : 'bg-accent text-on-accent'
                                  : 'bg-surface-1 text-ink-secondary hover:bg-surface-2'
                              }`}
                            >
                              {c === 'keep' ? t('review.duplicates.keep') : t('review.duplicates.trash')}
                            </button>
                          ))}
                        </div>
                      </li>
                    )
                  })}
                </ul>

                {allTrashed && (
                  <div className="mt-2">
                    <Banner kind="warning">{t('review.duplicates.allTrashedWarning')}</Banner>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
