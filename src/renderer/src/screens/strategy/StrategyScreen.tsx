import { useTranslation } from 'react-i18next'
import { CalendarDays, FileType2, PencilLine, Sparkles, type LucideIcon } from 'lucide-react'
import type { StrategyId } from '@shared/strategies'
import { strategiesConflict } from '@shared/strategies'
import { useApp } from '../../stores'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'

const STRATEGY_ICONS: Record<StrategyId, LucideIcon> = {
  smart: Sparkles,
  fileType: FileType2,
  date: CalendarDays,
  custom: PencilLine
}

const STRATEGY_ORDER: StrategyId[] = ['smart', 'fileType', 'date', 'custom']

export function StrategyScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const strategy = useApp((s) => s.strategy)
  const setStrategyId = useApp((s) => s.setStrategyId)
  const setDateGranularity = useApp((s) => s.setDateGranularity)
  const setCustomInstruction = useApp((s) => s.setCustomInstruction)
  const setReuseExisting = useApp((s) => s.setReuseExisting)
  const reorganizeEverything = useApp((s) => s.reorganizeEverything)
  const setReorganizeEverything = useApp((s) => s.setReorganizeEverything)
  const strategyIsValid = useApp((s) => s.strategyIsValid)
  const scan = useApp((s) => s.scanResult)
  const goTo = useApp((s) => s.goTo)

  const rerun = scan?.rerun ?? null
  const isRerun = rerun !== null && !reorganizeEverything
  const mismatch = isRerun && strategiesConflict(strategy, rerun.manifestStrategy)

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-5 overflow-y-auto p-8">
      <h1 className="text-[22px] font-semibold tracking-tight">{t('strategy.title')}</h1>

      <div className="grid grid-cols-2 gap-3">
        {STRATEGY_ORDER.map((id) => {
          const Icon = STRATEGY_ICONS[id]
          const selected = strategy.id === id
          return (
            <button
              key={id}
              type="button"
              onClick={() => setStrategyId(id)}
              aria-pressed={selected}
              className={`flex flex-col gap-1.5 rounded-xl border p-4 text-start transition-colors ${
                selected
                  ? 'border-accent bg-accent-soft/50 ring-1 ring-accent'
                  : 'border-line bg-surface-1 hover:border-line-strong'
              }`}
            >
              <span className="flex items-center gap-2">
                <Icon size={16} className={selected ? 'text-accent' : 'text-ink-faint'} aria-hidden />
                <span className="text-sm font-medium">{t(`strategy.${id}.name`)}</span>
              </span>
              <span className="text-xs text-ink-secondary">{t(`strategy.${id}.description`)}</span>
              {id !== 'custom' && (
                <span className="text-xs text-ink-faint">{t(`strategy.${id}.example`)}</span>
              )}

              {id === 'date' && selected && (
                <div
                  role="radiogroup"
                  aria-label={t('strategy.date.granularity')}
                  className="mt-2 flex overflow-hidden rounded-lg border border-line text-xs"
                  onClick={(e) => e.stopPropagation()}
                >
                  {(['year', 'year-month'] as const).map((g) => (
                    <button
                      key={g}
                      type="button"
                      role="radio"
                      aria-checked={(strategy.dateGranularity ?? 'year') === g}
                      onClick={() => setDateGranularity(g)}
                      className={`flex-1 px-2 py-1.5 ${
                        (strategy.dateGranularity ?? 'year') === g
                          ? 'bg-accent text-on-accent'
                          : 'bg-surface-1 text-ink-secondary hover:bg-surface-2'
                      }`}
                    >
                      {g === 'year' ? t('strategy.date.year') : t('strategy.date.yearMonth')}
                    </button>
                  ))}
                </div>
              )}

              {id === 'custom' && selected && (
                <div className="mt-2" onClick={(e) => e.stopPropagation()}>
                  <textarea
                    value={strategy.customInstruction ?? ''}
                    onChange={(e) => setCustomInstruction(e.target.value)}
                    placeholder={t('strategy.custom.placeholder')}
                    rows={3}
                    className="w-full resize-none rounded-lg border border-line bg-surface-1 px-2.5 py-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
                  />
                  <p className="mt-1 text-[11px] text-ink-faint">{t('strategy.custom.verbatimNote')}</p>
                </div>
              )}
            </button>
          )
        })}
      </div>

      <label className="flex items-center justify-between rounded-xl border border-line bg-surface-1 px-4 py-3">
        <span>
          <span className="block text-sm font-medium">{t('strategy.reuseExisting')}</span>
          <span className="block text-xs text-ink-faint">
            {isRerun ? t('strategy.reuseForcedRerun') : t('strategy.reuseExistingHint')}
          </span>
        </span>
        <input
          type="checkbox"
          checked={isRerun ? true : strategy.reuseExistingFolders}
          disabled={isRerun}
          onChange={(e) => setReuseExisting(e.target.checked)}
          className="size-4 accent-[var(--ord-accent)]"
        />
      </label>

      {mismatch && (
        <Banner
          kind="warning"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setReorganizeEverything(true)}>
              {t('strategy.mismatchReorganize')}
            </Button>
          }
        >
          {t('strategy.mismatchWarning', {
            previous: t(`strategy.${rerun.manifestStrategy.id}.name`)
          })}
        </Banner>
      )}

      <div className="mt-auto flex items-center justify-between pt-2">
        <Button variant="ghost" onClick={() => goTo('scan')}>
          {t('common.back')}
        </Button>
        <Button variant="primary" disabled={!strategyIsValid()} onClick={() => goTo('analyzing')}>
          {t('strategy.analyze')}
        </Button>
      </div>
    </div>
  )
}
