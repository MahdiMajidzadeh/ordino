import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, ChevronRight, ExternalLink, KeyRound, Plus, X } from 'lucide-react'
import type { OrdinoError } from '@shared/errors'
import type { AppInfo, ProviderId } from '@shared/types'
import { CLAUDE_MODELS, DEFAULT_OLLAMA_BASE_URL } from '@shared/models'
import { useApp } from '../../stores'
import { ordino } from '../../api/client'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'

type TestState =
  | { state: 'idle' }
  | { state: 'testing' }
  | { state: 'ok'; latencyMs: number; model?: string }
  | { state: 'error'; error: OrdinoError }

function HelpAccordion({ title, children }: { title: string; children: React.ReactNode }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-lg border border-line">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-3 py-2 text-xs font-medium text-ink-secondary hover:text-ink"
      >
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} aria-hidden />
        {title}
      </button>
      {open && <div className="space-y-1.5 px-3 pb-3 text-xs text-ink-secondary">{children}</div>}
    </div>
  )
}

function KeyField({
  provider,
  hasKey,
  label,
  hint,
  onChanged
}: {
  provider: ProviderId
  hasKey: boolean
  label: string
  hint?: string
  onChanged: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  const save = async (): Promise<void> => {
    if (!value.trim()) return
    await ordino.invoke('secrets:setKey', { provider, apiKey: value.trim() })
    setValue('')
    setEditing(false)
    onChanged()
  }

  return (
    <div>
      <label className="mb-1 block text-xs text-ink-faint">{label}</label>
      {hasKey && !editing ? (
        <div className="flex items-center gap-2 text-xs">
          <KeyRound size={13} className="text-new" aria-hidden />
          <span className="text-ink-secondary">{t('settings.provider.keySaved')}</span>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            {t('settings.provider.keyReplace')}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={async () => {
              await ordino.invoke('secrets:clearKey', { provider })
              onChanged()
            }}
          >
            {t('settings.provider.keyClear')}
          </Button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <input
            type="password"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
            placeholder="sk-…"
            className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface-1 px-2 text-sm outline-none focus:border-accent"
          />
          <Button size="sm" onClick={() => void save()} disabled={!value.trim()}>
            {t('common.save')}
          </Button>
          {hasKey && (
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      )}
      {hint && <p className="mt-1 text-[11px] text-ink-faint">{hint}</p>}
    </div>
  )
}

export function SettingsScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const settings = useApp((s) => s.settings)
  const detection = useApp((s) => s.claudeDetection)
  const loadSettings = useApp((s) => s.loadSettings)
  const patchSettings = useApp((s) => s.patchSettings)
  const detectClaude = useApp((s) => s.detectClaude)

  const [test, setTest] = useState<TestState>({ state: 'idle' })
  const [openaiModels, setOpenaiModels] = useState<string[] | null>(null)
  const [modelsFailed, setModelsFailed] = useState(false)
  const [newGlob, setNewGlob] = useState('')
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)

  useEffect(() => {
    void loadSettings()
    void detectClaude()
    void ordino.invoke('app:info', undefined).then((res) => {
      if (res.ok) setAppInfo(res.data)
    })
  }, [loadSettings, detectClaude])

  if (!settings) return <div className="h-full" />

  const provider = settings.provider

  const runTest = async (): Promise<void> => {
    setTest({ state: 'testing' })
    const req =
      provider === 'claude-cli'
        ? ({ provider: 'claude-cli', model: settings.claude.model } as const)
        : ({
            provider: 'openai-compat',
            baseUrl: settings.openaiCompat.baseUrl,
            model: settings.openaiCompat.model,
            useStoredKey: true
          } as const)
    const res = await ordino.invoke('provider:testConnection', req)
    if (res.ok) setTest({ state: 'ok', latencyMs: res.data.latencyMs, model: res.data.model })
    else setTest({ state: 'error', error: res.error })
  }

  const fetchModels = async (): Promise<void> => {
    setModelsFailed(false)
    const res = await ordino.invoke('provider:listModels', {
      provider: 'openai-compat',
      baseUrl: settings.openaiCompat.baseUrl,
      useStoredKey: true
    })
    if (res.ok && res.data.models.length > 0) setOpenaiModels(res.data.models)
    else {
      setOpenaiModels(null)
      setModelsFailed(true)
    }
  }

  return (
    <div className="mx-auto h-full max-w-2xl space-y-6 overflow-y-auto p-8">
      <h1 className="text-[22px] font-semibold tracking-tight">{t('settings.title')}</h1>

      {/* ---- Provider ---- */}
      <section className="space-y-3">
        <h2 className="text-sm font-medium text-ink-secondary">{t('settings.provider.title')}</h2>

        {/* Claude Code card */}
        <div
          className={`rounded-xl border p-4 ${provider === 'claude-cli' ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="provider"
              checked={provider === 'claude-cli'}
              onChange={() => void patchSettings({ provider: 'claude-cli' })}
              className="mt-1 accent-[var(--ord-accent)]"
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-2 text-sm font-medium">
                {t('settings.provider.claude.name')}
                <span className="rounded bg-accent-soft px-1.5 py-px text-[10px] text-accent">
                  {t('settings.provider.claude.badge')}
                </span>
              </span>
              <span className="mt-0.5 block text-xs text-ink-secondary">
                {t('settings.provider.claude.description')}
              </span>
            </span>
          </label>

          {provider === 'claude-cli' && (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              {detection?.installed ? (
                <div className="flex items-center gap-2 text-xs text-ink-secondary">
                  <CheckCircle2 size={13} className="text-new" aria-hidden />
                  {t('settings.provider.claude.detected', { version: detection.version ?? '' })}
                  <span className="truncate text-ink-faint">
                    {t('settings.provider.claude.detectedAt', { path: detection.path })}
                  </span>
                </div>
              ) : (
                <Banner
                  kind="warning"
                  actions={
                    <Button
                      size="sm"
                      onClick={() =>
                        void ordino.invoke('shell:openExternal', {
                          url: 'https://claude.com/claude-code'
                        })
                      }
                    >
                      <ExternalLink size={12} aria-hidden />
                      {t('settings.provider.claude.install')}
                    </Button>
                  }
                >
                  {t('settings.provider.claude.notDetected')}
                </Banner>
              )}

              <div>
                <label className="mb-1 block text-xs text-ink-faint">
                  {t('settings.provider.claude.model')}
                </label>
                <select
                  value={settings.claude.model}
                  onChange={(e) => void patchSettings({ claude: { model: e.target.value } } as never)}
                  className="h-8 w-56 rounded-md border border-line bg-surface-1 px-2 text-sm outline-none focus:border-accent"
                >
                  {CLAUDE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {t(m.labelKey)}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-xs text-ink-faint">
                  {t('settings.provider.claude.pathOverride')}
                </label>
                <input
                  value={settings.claude.cliPathOverride}
                  onChange={(e) =>
                    void patchSettings({ claude: { cliPathOverride: e.target.value } } as never)
                  }
                  onBlur={() => void detectClaude()}
                  placeholder={t('settings.provider.claude.pathOverridePlaceholder')}
                  className="h-8 w-full rounded-md border border-line bg-surface-1 px-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </div>

              <KeyField
                provider="claude-cli"
                hasKey={settings.claude.hasApiKeyOverride}
                label={t('settings.provider.claude.apiKeyOverride')}
                hint={t('settings.provider.claude.apiKeyOverrideHint')}
                onChanged={() => void loadSettings()}
              />

              <HelpAccordion title={t('settings.provider.claude.name')}>
                <p>1. {t('settings.provider.claude.help.step1')}</p>
                <p>2. {t('settings.provider.claude.help.step2')}</p>
                <p>3. {t('settings.provider.claude.help.step3')}</p>
              </HelpAccordion>
            </div>
          )}
        </div>

        {/* OpenAI-compatible card */}
        <div
          className={`rounded-xl border p-4 ${provider === 'openai-compat' ? 'border-accent ring-1 ring-accent' : 'border-line'}`}
        >
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="radio"
              name="provider"
              checked={provider === 'openai-compat'}
              onChange={() => void patchSettings({ provider: 'openai-compat' })}
              className="mt-1 accent-[var(--ord-accent)]"
            />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium">{t('settings.provider.openai.name')}</span>
              <span className="mt-0.5 block text-xs text-ink-secondary">
                {t('settings.provider.openai.description')}
              </span>
            </span>
          </label>

          {provider === 'openai-compat' && (
            <div className="mt-3 space-y-3 border-t border-line pt-3">
              <div>
                <label className="mb-1 block text-xs text-ink-faint">
                  {t('settings.provider.openai.baseUrl')}
                </label>
                <input
                  value={settings.openaiCompat.baseUrl}
                  onChange={(e) =>
                    void patchSettings({ openaiCompat: { baseUrl: e.target.value } } as never)
                  }
                  placeholder={DEFAULT_OLLAMA_BASE_URL}
                  className="h-8 w-full rounded-md border border-line bg-surface-1 px-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
                />
              </div>

              <KeyField
                provider="openai-compat"
                hasKey={settings.openaiCompat.hasKey}
                label={t('settings.provider.openai.apiKeyOptional')}
                onChanged={() => void loadSettings()}
              />

              <div>
                <label className="mb-1 block text-xs text-ink-faint">
                  {t('settings.provider.openai.model')}
                </label>
                <div className="flex gap-1.5">
                  {openaiModels ? (
                    <select
                      value={settings.openaiCompat.model}
                      onChange={(e) =>
                        void patchSettings({ openaiCompat: { model: e.target.value } } as never)
                      }
                      className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface-1 px-2 text-sm outline-none focus:border-accent"
                    >
                      {!openaiModels.includes(settings.openaiCompat.model) && (
                        <option value={settings.openaiCompat.model}>{settings.openaiCompat.model}</option>
                      )}
                      {openaiModels.map((m) => (
                        <option key={m} value={m}>
                          {m}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      value={settings.openaiCompat.model}
                      onChange={(e) =>
                        void patchSettings({ openaiCompat: { model: e.target.value } } as never)
                      }
                      placeholder="llama3.2"
                      className="h-8 min-w-0 flex-1 rounded-md border border-line bg-surface-1 px-2 text-sm outline-none placeholder:text-ink-faint focus:border-accent"
                    />
                  )}
                  <Button size="sm" onClick={() => void fetchModels()} disabled={!settings.openaiCompat.baseUrl}>
                    {t('settings.provider.openai.fetchModels')}
                  </Button>
                </div>
                {modelsFailed && (
                  <p className="mt-1 text-[11px] text-ink-faint">
                    {t('settings.provider.openai.modelManualNote')}
                  </p>
                )}
              </div>

              <HelpAccordion title={t('settings.provider.openai.help.openaiTitle')}>
                <p>{t('settings.provider.openai.help.openai1')}</p>
                <p>{t('settings.provider.openai.help.openai2')}</p>
              </HelpAccordion>
              <HelpAccordion title={t('settings.provider.openai.help.openrouterTitle')}>
                <p>{t('settings.provider.openai.help.openrouter1')}</p>
                <p>{t('settings.provider.openai.help.openrouter2')}</p>
              </HelpAccordion>
              <HelpAccordion title={t('settings.provider.openai.help.ollamaTitle')}>
                <p>{t('settings.provider.openai.help.ollama1')}</p>
                <p>{t('settings.provider.openai.help.ollama2')}</p>
              </HelpAccordion>
            </div>
          )}
        </div>

        {/* Test connection */}
        <div className="flex items-center gap-3">
          <Button onClick={() => void runTest()} disabled={test.state === 'testing'}>
            {test.state === 'testing'
              ? t('settings.provider.testing')
              : t('settings.provider.testConnection')}
          </Button>
          {test.state === 'ok' && (
            <span className="flex items-center gap-1.5 text-xs text-new">
              <CheckCircle2 size={13} aria-hidden />
              {t('settings.provider.testOk', {
                model: test.model ?? '',
                latency: `${(test.latencyMs / 1000).toFixed(1)}s`
              })}
            </span>
          )}
        </div>
        {test.state === 'error' && (
          <Banner kind="error">
            {t(`errors.${test.error.code}`, { defaultValue: test.error.message })}
            {test.error.detail && (
              <span className="mt-1 block font-mono text-[11px] break-all text-ink-faint">
                {test.error.detail}
              </span>
            )}
          </Banner>
        )}
      </section>

      {/* ---- Ignore patterns (P1-6) ---- */}
      <section className="space-y-2">
        <h2 className="text-sm font-medium text-ink-secondary">{t('settings.ignore.title')}</h2>
        <p className="text-xs text-ink-faint">{t('settings.ignore.hint')}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {settings.ignoreGlobs.map((glob) => (
            <span
              key={glob}
              className="flex items-center gap-1 rounded-md border border-line bg-surface-1 px-2 py-1 font-mono text-xs"
            >
              {glob}
              <button
                type="button"
                aria-label={`${t('settings.provider.keyClear')} ${glob}`}
                onClick={() =>
                  void patchSettings({ ignoreGlobs: settings.ignoreGlobs.filter((g) => g !== glob) })
                }
                className="text-ink-faint hover:text-danger"
              >
                <X size={11} aria-hidden />
              </button>
            </span>
          ))}
          <span className="flex items-center gap-1">
            <input
              value={newGlob}
              onChange={(e) => setNewGlob(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newGlob.trim()) {
                  void patchSettings({ ignoreGlobs: [...settings.ignoreGlobs, newGlob.trim()] })
                  setNewGlob('')
                }
              }}
              placeholder={t('settings.ignore.placeholder')}
              className="h-7 w-64 rounded-md border border-line bg-surface-1 px-2 font-mono text-xs outline-none placeholder:font-sans placeholder:text-ink-faint focus:border-accent"
            />
            <button
              type="button"
              aria-label={t('settings.ignore.placeholder')}
              disabled={!newGlob.trim()}
              onClick={() => {
                void patchSettings({ ignoreGlobs: [...settings.ignoreGlobs, newGlob.trim()] })
                setNewGlob('')
              }}
              className="rounded p-1 text-ink-faint hover:text-ink disabled:opacity-40"
            >
              <Plus size={13} aria-hidden />
            </button>
          </span>
        </div>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void patchSettings({ ignoreGlobs: ['node_modules', '.git', '*.tmp'] })}
        >
          {t('settings.ignore.restoreDefaults')}
        </Button>
      </section>

      {/* ---- Privacy ---- */}
      <section className="space-y-1 rounded-xl border border-line bg-surface-1 p-4">
        <h2 className="text-sm font-medium">{t('settings.privacy.title')}</h2>
        <p className="text-xs text-ink-secondary">{t('settings.privacy.statement')}</p>
        <p className="text-xs text-ink-faint">{t('settings.privacy.localNote')}</p>
      </section>

      {/* ---- About ---- */}
      <section className="space-y-1 rounded-xl border border-line bg-surface-1 p-4">
        <h2 className="text-sm font-medium">{t('settings.about.title')}</h2>
        <p className="text-xs text-ink-secondary">
          {appInfo
            ? t('settings.about.version', { version: appInfo.version })
            : t('settings.about.versionUnknown')}
          {appInfo && !appInfo.isPackaged ? ` · ${t('settings.about.devBuild')}` : ''}
        </p>
        {appInfo && (
          <p className="text-xs text-ink-faint">
            {[
              appInfo.buildRef,
              `${appInfo.platform}-${appInfo.arch}`,
              `Electron ${appInfo.electron}`
            ]
              .filter(Boolean)
              .join(' · ')}
          </p>
        )}
      </section>
    </div>
  )
}
