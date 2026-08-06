import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Clock, Settings, X } from 'lucide-react'
import { useApp } from './stores'
import { SettingsScreen } from './screens/settings/SettingsScreen'
import { HistoryScreen } from './screens/history/HistoryScreen'
import { STEP_OF_SCREEN, type Screen } from './stores/wizardSlice'
import { StepIndicator } from './components/ui/StepIndicator'
import { DevToolbar } from './components/DevToolbar'
import { HomeScreen } from './screens/home/HomeScreen'
import { ScanScreen } from './screens/scan/ScanScreen'
import { StrategyScreen } from './screens/strategy/StrategyScreen'
import { AnalysisScreen } from './screens/analysis/AnalysisScreen'
import { ReviewScreen } from './screens/review/ReviewScreen'
import { ApplyScreen } from './screens/apply/ApplyScreen'
import { DoneScreen } from './screens/done/DoneScreen'

function CurrentScreen({ screen }: { screen: Screen }): React.JSX.Element {
  switch (screen) {
    case 'home':
      return <HomeScreen />
    case 'scan':
      return <ScanScreen />
    case 'strategy':
      return <StrategyScreen />
    case 'analyzing':
      return <AnalysisScreen />
    case 'review':
      return <ReviewScreen />
    case 'applying':
      return <ApplyScreen />
    case 'done':
      return <DoneScreen />
  }
}

export default function App(): React.JSX.Element {
  const { t } = useTranslation()
  const screen = useApp((s) => s.screen)
  const overlay = useApp((s) => s.overlay)
  const openOverlay = useApp((s) => s.openOverlay)
  const closeOverlay = useApp((s) => s.closeOverlay)
  const goTo = useApp((s) => s.goTo)
  const loadSettings = useApp((s) => s.loadSettings)

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const activeStep = STEP_OF_SCREEN[screen]

  const onStepClick = (step: number): void => {
    // Only backwards navigation; forward steps require completing the flow.
    if (step === 0) goTo(screen === 'home' ? 'home' : 'scan')
    else if (step === 1) goTo('strategy')
    else if (step === 2) goTo('review')
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-line bg-surface-1 px-4">
        <div className="flex items-baseline gap-2">
          <span className="text-sm font-semibold tracking-tight">{t('app.name')}</span>
        </div>
        <StepIndicator active={activeStep} onStepClick={onStepClick} />
        <div className="flex items-center gap-1">
          <button
            type="button"
            aria-label={t('topbar.history')}
            title={t('topbar.history')}
            onClick={() => (overlay === 'history' ? closeOverlay() : openOverlay('history'))}
            className="rounded-md p-1.5 text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Clock size={16} aria-hidden />
          </button>
          <button
            type="button"
            aria-label={t('topbar.settings')}
            title={t('topbar.settings')}
            onClick={() => (overlay === 'settings' ? closeOverlay() : openOverlay('settings'))}
            className="rounded-md p-1.5 text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink"
          >
            <Settings size={16} aria-hidden />
          </button>
        </div>
      </header>

      <main className="relative min-h-0 flex-1">
        <CurrentScreen screen={screen} />
        {overlay && (
          <div className="absolute inset-0 z-40 bg-surface-0">
            <button
              type="button"
              aria-label={t('common.close')}
              onClick={closeOverlay}
              className="absolute end-4 top-4 z-50 rounded-md p-1.5 text-ink-secondary transition-colors hover:bg-surface-2 hover:text-ink"
            >
              <X size={16} aria-hidden />
            </button>
            {overlay === 'settings' ? <SettingsScreen /> : <HistoryScreen />}
          </div>
        )}
      </main>

      <DevToolbar />
    </div>
  )
}
