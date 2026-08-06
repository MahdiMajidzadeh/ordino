import { useTranslation } from 'react-i18next'
import { useApp } from '../../stores'
import { ProgressBar } from '../../components/ui/ProgressBar'

export function ApplyScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const progress = useApp((s) => s.applyProgress)

  const fraction = progress && progress.total > 0 ? progress.done / progress.total : undefined

  return (
    <div className="mx-auto flex h-full max-w-xl flex-col justify-center gap-5 p-8">
      <h1 className="text-[22px] font-semibold tracking-tight">{t('apply.title')}</h1>
      <ProgressBar fraction={fraction} />
      <p className="min-h-5 truncate text-sm text-ink-secondary">
        {progress
          ? progress.stage === 'trashing'
            ? t('apply.trashing')
            : t('apply.moving', {
                done: progress.done,
                total: progress.total,
                file: progress.currentRelPath.split('/').pop()
              })
          : ''}
      </p>
    </div>
  )
}
