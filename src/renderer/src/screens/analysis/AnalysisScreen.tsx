import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { Copy, Sparkles } from 'lucide-react'
import { useApp } from '../../stores'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'
import { ProgressBar } from '../../components/ui/ProgressBar'
import { formatRelative } from '../../lib/format'

export function AnalysisScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const scan = useApp((s) => s.scanResult)
  const progress = useApp((s) => s.analysisProgress)
  const dupes = useApp((s) => s.duplicatesProgress)
  const error = useApp((s) => s.analysisError)
  const nothingToDo = useApp((s) => s.nothingToDo)
  const startAnalysis = useApp((s) => s.startAnalysis)
  const cancelAnalysis = useApp((s) => s.cancelAnalysis)
  const openOverlay = useApp((s) => s.openOverlay)
  const goTo = useApp((s) => s.goTo)
  const setReorganizeEverything = useApp((s) => s.setReorganizeEverything)

  // Kick off exactly once per entry into this screen.
  const startedRef = useRef(false)
  useEffect(() => {
    if (!startedRef.current) {
      startedRef.current = true
      void startAnalysis()
    }
  }, [startAnalysis])

  // Before the first streamed token the count sits at 0 — show an
  // indeterminate bar and say the model is working, or it reads as frozen.
  const waitingForModel = progress?.phase === 'analyzing' && progress.filesAnalyzed === 0
  const fraction =
    progress && progress.filesTotal > 0 && !waitingForModel
      ? progress.filesAnalyzed / progress.filesTotal
      : undefined

  const phaseLabel = (): string => {
    if (!progress || progress.phase === 'preparing') return t('analysis.preparing')
    if (progress.phase === 'repairing') return t('analysis.repairing')
    if (progress.phase === 'assembling') return t('analysis.assembling')
    const chunkPrefix =
      progress.chunk.total > 1
        ? `${t('analysis.chunk', { current: progress.chunk.current, total: progress.chunk.total })} · `
        : ''
    if (waitingForModel) return `${chunkPrefix}${t('analysis.waitingModel')}`
    return `${chunkPrefix}${t('analysis.analyzing', {
      done: progress.filesAnalyzed,
      total: progress.filesTotal
    })}`
  }

  if (error) {
    const isUnconfigured = error.code === 'PROVIDER_NOT_CONFIGURED' || error.code === 'CLAUDE_NOT_INSTALLED'
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-4 p-8">
        <Banner
          kind="error"
          actions={
            <>
              {error.retryable && (
                <Button size="sm" onClick={() => void startAnalysis()}>
                  {t('common.retry')}
                </Button>
              )}
              {isUnconfigured && (
                <Button size="sm" variant="primary" onClick={() => openOverlay('settings')}>
                  {t('analysis.openSettings')}
                </Button>
              )}
            </>
          }
        >
          {t(`errors.${error.code}`, { defaultValue: error.message })}
          {error.detail && (
            <span className="mt-1 block font-mono text-[11px] break-all text-ink-faint">
              {error.detail}
            </span>
          )}
        </Banner>
        <Button variant="ghost" onClick={() => goTo('strategy')}>
          {t('common.back')}
        </Button>
      </div>
    )
  }

  if (nothingToDo) {
    return (
      <div className="mx-auto flex h-full max-w-xl flex-col items-center justify-center gap-3 p-8 text-center">
        <Sparkles size={32} className="text-new" aria-hidden />
        <div className="text-lg font-medium">{t('scan.rerun.alreadyOrganized')}</div>
        <p className="text-sm text-ink-secondary">{t('scan.rerun.alreadyOrganizedHint')}</p>
        <div className="mt-2 flex gap-2">
          <Button onClick={() => goTo('home')}>{t('common.back')}</Button>
          <Button
            variant="ghost"
            onClick={() => {
              setReorganizeEverything(true)
              void startAnalysis()
            }}
          >
            {t('scan.rerun.reorganizeEverything')}
          </Button>
        </div>
        <p className="text-xs text-ink-faint">
          {t('home.recentOrganized', { when: formatRelative(nothingToDo.lastAppliedAt) })}
        </p>
      </div>
    )
  }

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-6 p-8">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight">
          {t('analysis.title', { name: scan?.rootName ?? '' })}
        </h1>
        <p className="mt-1 text-sm text-ink-secondary">{phaseLabel()}</p>
      </div>

      <ProgressBar fraction={fraction} />

      <div className="flex items-center gap-2 text-xs text-ink-faint">
        <Copy size={13} aria-hidden />
        {dupes && dupes.done && dupes.candidates === 0
          ? t('analysis.duplicatesDone', { count: 0 })
          : dupes
            ? t('analysis.duplicates', { hashed: dupes.hashed, candidates: dupes.candidates })
            : t('analysis.preparing')}
      </div>

      <div>
        <Button variant="ghost" onClick={() => void cancelAnalysis()}>
          {t('common.cancel')}
        </Button>
      </div>
    </div>
  )
}
