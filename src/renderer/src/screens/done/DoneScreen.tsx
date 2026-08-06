import { useTranslation } from 'react-i18next'
import { CheckCircle2, Clock, FolderOpen, RotateCcw, Undo2 } from 'lucide-react'
import { useApp } from '../../stores'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'
import { ordino } from '../../api/client'

export function DoneScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const result = useApp((s) => s.applyResult)
  const error = useApp((s) => s.applyError)
  const undoResult = useApp((s) => s.undoResult)
  const undoRunning = useApp((s) => s.undoRunning)
  const undoLastApply = useApp((s) => s.undoLastApply)
  const scan = useApp((s) => s.scanResult)
  const resetWizard = useApp((s) => s.resetWizard)
  const clearScan = useApp((s) => s.clearScan)
  const clearAnalysis = useApp((s) => s.clearAnalysis)
  const openOverlay = useApp((s) => s.openOverlay)

  const organizeAnother = (): void => {
    clearAnalysis()
    clearScan()
    resetWizard()
  }

  if (error) {
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4 p-8">
        <Banner kind="error">{t(`errors.${error.code}`, { defaultValue: error.message })}</Banner>
        <Button variant="ghost" onClick={organizeAnother}>
          {t('apply.done.organizeAnother')}
        </Button>
      </div>
    )
  }

  if (!result) return <div className="h-full" />

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-5 overflow-y-auto p-8">
      <div className="flex flex-col items-center gap-3 text-center">
        <CheckCircle2 size={40} className="text-new" strokeWidth={1.5} aria-hidden />
        <h1 className="text-[22px] font-semibold tracking-tight">
          {undoResult ? t('apply.undo.done') : t('apply.done.title')}
        </h1>
        {!undoResult && (
          <p className="text-sm text-ink-secondary">
            {t('apply.done.summary', {
              moved: result.moved,
              skipped: result.skipped.length,
              failed: result.failed.length
            })}
            {result.trashed > 0 && <> · {t('apply.done.trashed', { count: result.trashed })}</>}
          </p>
        )}
      </div>

      {undoResult && undoResult.notRestored.length > 0 && (
        <Banner kind="warning">
          <div>{t('apply.undo.doneWithSkips', { count: undoResult.notRestored.length })}</div>
          <ul className="mt-1 space-y-0.5 text-xs">
            {undoResult.notRestored.map((s) => (
              <li key={s.path}>
                {s.path} — {t(`apply.skipReason.${s.reasonCode}`)}
              </li>
            ))}
          </ul>
        </Banner>
      )}

      {!undoResult && result.collisions.length > 0 && (
        <div className="space-y-1 rounded-lg border border-line bg-surface-1 p-3 text-xs text-ink-secondary">
          {result.collisions.map((c) => (
            <div key={c.from}>
              {t('apply.done.collision', {
                from: c.from.split('/').pop(),
                folder: c.finalDestination.includes('/')
                  ? c.finalDestination.slice(0, c.finalDestination.lastIndexOf('/'))
                  : '/',
                renamed: c.finalDestination.split('/').pop()
              })}
            </div>
          ))}
        </div>
      )}

      {!undoResult && (result.skipped.length > 0 || result.failed.length > 0) && (
        <div className="space-y-2">
          {[
            { title: t('apply.done.skippedTitle'), items: result.skipped },
            { title: t('apply.done.failedTitle'), items: result.failed }
          ]
            .filter((s) => s.items.length > 0)
            .map((section) => (
              <div
                key={section.title}
                className="rounded-lg border border-line bg-surface-1 p-3 text-xs"
              >
                <div className="mb-1 font-medium">{section.title}</div>
                <ul className="space-y-0.5 text-ink-secondary">
                  {section.items.map((s) => (
                    <li key={s.path}>
                      {s.path} — {t(`apply.skipReason.${s.reasonCode}`)}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-2">
        {!undoResult && (
          <Button onClick={() => void undoLastApply()} disabled={undoRunning}>
            <Undo2 size={14} aria-hidden />
            {undoRunning ? t('apply.undo.running') : t('common.undo')}
          </Button>
        )}
        {scan && (
          <Button
            variant="ghost"
            onClick={() => void ordino.invoke('shell:reveal', { path: scan.rootPath })}
          >
            <FolderOpen size={14} aria-hidden />
            {t('apply.done.revealFolder')}
          </Button>
        )}
        <Button variant="primary" onClick={organizeAnother}>
          <RotateCcw size={14} aria-hidden />
          {t('apply.done.organizeAnother')}
        </Button>
        <Button variant="ghost" onClick={() => openOverlay('history')}>
          <Clock size={14} aria-hidden />
          {t('apply.done.viewHistory')}
        </Button>
      </div>
    </div>
  )
}
