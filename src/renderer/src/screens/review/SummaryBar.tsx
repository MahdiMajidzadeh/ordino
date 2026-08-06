import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import type { ReviewStats } from '../../lib/reviewTrees'
import { useApp } from '../../stores'
import { Button } from '../../components/ui/Button'
import { ordino } from '../../api/client'
import { effectiveMovesOf } from '../../stores/planSlice'

export function SummaryBar({ stats }: { stats: ReviewStats }): React.JSX.Element {
  const { t } = useTranslation()
  const startApply = useApp((s) => s.startApply)
  const goTo = useApp((s) => s.goTo)
  const [exportOpen, setExportOpen] = useState(false)

  const exportPlan = async (format: 'json' | 'markdown'): Promise<void> => {
    setExportOpen(false)
    const { plan, decisions, dupeChoices, scanResult } = useApp.getState()
    if (!plan || !scanResult) return
    const moves = effectiveMovesOf(plan, decisions, dupeChoices)
      .filter((m) => m.included)
      .map((m) => ({ fileId: m.fileId, source: m.source, destination: m.destination }))
    const trash = scanResult.files
      .filter((f) => dupeChoices[f.id] === 'trash')
      .map((f) => ({ fileId: f.id, path: f.relPath }))
    await ordino.invoke('export:plan', {
      planId: plan.planId,
      format,
      moves,
      trash,
      newFolders: plan.newFolders,
      summary: summaryText
    })
  }

  const summaryText = `${t('common.files', { count: stats.includedMoves })} → ${t('common.folders', {
    count: stats.targetFolders
  })} (${stats.newFolderCount} new)`

  return (
    <footer className="flex shrink-0 items-center justify-between gap-4 border-t border-line bg-surface-1 px-4 py-2.5">
      <div className="min-w-0 text-sm text-ink-secondary">
        <span className="font-medium text-ink">{summaryText}</span>
        {stats.duplicateGroups > 0 && (
          <span> · {t('review.summaryDuplicates', { count: stats.duplicateGroups })}</span>
        )}
        {stats.excluded > 0 && <span> · {t('review.summaryExcluded', { count: stats.excluded })}</span>}
        {stats.trashed > 0 && <span> · {t('review.duplicates.trashGhost', { count: stats.trashed })}</span>}
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <div className="relative">
          <Button size="sm" variant="ghost" onClick={() => setExportOpen((o) => !o)}>
            <Download size={13} aria-hidden />
            {t('review.exportPlan')}
          </Button>
          {exportOpen && (
            <div className="absolute bottom-9 right-0 z-30 w-40 rounded-lg border border-line bg-surface-1 py-1 shadow-lg">
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-start text-xs hover:bg-surface-2"
                onClick={() => void exportPlan('json')}
              >
                {t('review.exportJson')}
              </button>
              <button
                type="button"
                className="block w-full px-3 py-1.5 text-start text-xs hover:bg-surface-2"
                onClick={() => void exportPlan('markdown')}
              >
                {t('review.exportMarkdown')}
              </button>
            </div>
          )}
        </div>
        <Button variant="ghost" onClick={() => goTo('strategy')}>
          {t('common.cancel')}
        </Button>
        <Button
          variant="primary"
          disabled={stats.includedMoves === 0 && stats.trashed === 0}
          title={stats.includedMoves === 0 && stats.trashed === 0 ? t('review.applyNothing') : undefined}
          onClick={() => void startApply()}
        >
          {t('review.applyMoves', { count: stats.includedMoves })}
        </Button>
      </div>
    </footer>
  )
}
