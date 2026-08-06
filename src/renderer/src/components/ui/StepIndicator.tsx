import { useTranslation } from 'react-i18next'
import { Check } from 'lucide-react'

const STEP_KEYS = ['steps.folder', 'steps.options', 'steps.review', 'steps.done'] as const

export interface StepIndicatorProps {
  /** 0-based active step. */
  active: number
  /** Steps < backLimit are clickable to navigate back. */
  onStepClick?: (step: number) => void
}

export function StepIndicator({ active, onStepClick }: StepIndicatorProps): React.JSX.Element {
  const { t } = useTranslation()
  return (
    <nav aria-label="Progress" className="flex items-center gap-1">
      {STEP_KEYS.map((key, i) => {
        const isDone = i < active
        const isActive = i === active
        const clickable = isDone && onStepClick !== undefined
        return (
          <div key={key} className="flex items-center gap-1">
            {i > 0 && <div className={`h-px w-6 ${isDone || isActive ? 'bg-accent' : 'bg-line'}`} />}
            <button
              type="button"
              disabled={!clickable}
              onClick={clickable ? () => onStepClick(i) : undefined}
              className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? 'bg-accent-soft text-accent'
                  : isDone
                    ? 'text-ink-secondary hover:bg-surface-2'
                    : 'text-ink-faint'
              } ${clickable ? 'cursor-pointer' : 'cursor-default'}`}
              aria-current={isActive ? 'step' : undefined}
            >
              <span
                className={`flex size-4 items-center justify-center rounded-full text-[10px] ${
                  isActive
                    ? 'bg-accent text-on-accent'
                    : isDone
                      ? 'bg-accent/70 text-on-accent'
                      : 'bg-surface-2 text-ink-faint'
                }`}
              >
                {isDone ? <Check size={10} aria-hidden /> : i + 1}
              </span>
              {t(key)}
            </button>
          </div>
        )
      })}
    </nav>
  )
}
