import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Sparkles } from 'lucide-react'
import { useApp } from '../../stores'
import { Button } from '../../components/ui/Button'
import { Banner } from '../../components/ui/Banner'
import { ProgressBar } from '../../components/ui/ProgressBar'
import { FolderTree } from '../../components/tree/FolderTree'
import { buildScanTree, flattenTree, type FlatRow } from '../../lib/tree'
import { checkStateOf, countIncludedFiles } from '../../lib/inclusion'
import { formatSize, formatRelative } from '../../lib/format'

export function ScanScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const quick = useApp((s) => s.quick)
  const scan = useApp((s) => s.scanResult)
  const scanning = useApp((s) => s.scanning)
  const scanError = useApp((s) => s.scanError)
  const rootPath = useApp((s) => s.rootPath)
  const choices = useApp((s) => s.inclusionChoices)
  const toggleInclusion = useApp((s) => s.toggleInclusion)
  const includeAllDirs = useApp((s) => s.includeAllDirs)
  const skipAllDirs = useApp((s) => s.skipAllDirs)
  const goTo = useApp((s) => s.goTo)
  const selectFolder = useApp((s) => s.selectFolder)
  const setReorganizeEverything = useApp((s) => s.setReorganizeEverything)
  const undoStatus = useApp((s) => s.undoStatus)
  const undoRunning = useApp((s) => s.undoRunning)
  const undoLastApply = useApp((s) => s.undoLastApply)
  const clearScan = useApp((s) => s.clearScan)
  const clearAnalysis = useApp((s) => s.clearAnalysis)

  /** Drop this folder entirely and return to the picker. */
  const startOver = (): void => {
    clearAnalysis()
    clearScan()
    goTo('home')
  }

  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())
  const [expandedInitialized, setExpandedInitialized] = useState(false)

  const dirTree = useMemo(
    () =>
      scan
        ? buildScanTree(scan.dirs, [], {
            includeFiles: false,
            dirBadge: (d) => (d.managedByOrdino ? 'managed' : undefined)
          })
        : [],
    [scan]
  )

  // First render with data: expand the top two levels.
  if (scan && !expandedInitialized) {
    const initial = new Set<string>()
    for (const d of scan.dirs) if (d.depth < 2) initial.add(`d:${d.relPath}`)
    setExpanded(initial)
    setExpandedInitialized(true)
  }

  const rows = useMemo(() => flattenTree(dirTree, expanded), [dirTree, expanded])
  const includedFiles = useMemo(
    () => (scan ? countIncludedFiles(scan.files, choices) : 0),
    [scan, choices]
  )

  const onToggleExpand = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const checkState = (row: FlatRow): 'checked' | 'unchecked' | 'indeterminate' =>
    scan ? checkStateOf(row.path, scan.dirs, choices) : 'checked'

  if (scanError) {
    return (
      <div className="mx-auto flex h-full max-w-2xl flex-col justify-center gap-4 p-8">
        <Banner
          kind="error"
          actions={
            <Button size="sm" onClick={() => rootPath && void selectFolder(rootPath)}>
              {t('common.retry')}
            </Button>
          }
        >
          {t(`errors.${scanError.code}`, { defaultValue: scanError.message })}
        </Banner>
        <Button variant="ghost" onClick={startOver}>
          <ArrowLeft size={14} aria-hidden />
          {t('scan.chooseAnotherFolder')}
        </Button>
      </div>
    )
  }

  // Gates the primary action: nothing to organize means nothing to configure.
  const hasFilesToOrganize = scan !== null && !scan.rerun?.nothingToDo && scan.files.length > 0

  const name = scan?.rootName ?? quick?.rootName ?? ''
  const fileCount = scan ? scan.files.length : (quick?.fileCount ?? 0)
  const dirCount = scan ? scan.dirs.length : (quick?.dirCount ?? 0)
  const totalSize = scan ? scan.totalSize : (quick?.totalSize ?? 0)
  const rerun = scan?.rerun ?? null

  return (
    <div className="mx-auto flex h-full max-w-3xl flex-col gap-4 p-8">
      <header>
        <h1 className="text-[22px] font-semibold tracking-tight">{t('scan.title', { name })}</h1>
        <p className="mt-1 text-sm text-ink-secondary">
          {t('common.files', { count: fileCount })} · {t('common.folders', { count: dirCount })} ·{' '}
          {formatSize(totalSize, t)}
        </p>
      </header>

      {scanning && <ProgressBar />}

      {undoStatus?.recovery && (
        <Banner
          kind="warning"
          actions={
            <Button
              size="sm"
              disabled={undoRunning}
              onClick={async () => {
                await undoLastApply()
                if (rootPath) void selectFolder(rootPath)
              }}
            >
              {undoRunning ? t('apply.undo.running') : t('common.undo')}
            </Button>
          }
        >
          {t('apply.undo.recoveryOffer')}
        </Banner>
      )}

      {rerun && !rerun.nothingToDo && (
        <Banner
          kind="info"
          actions={
            <Button size="sm" variant="ghost" onClick={() => setReorganizeEverything(true)}>
              {t('scan.rerun.reorganizeEverything')}
            </Button>
          }
        >
          {t('scan.rerun.banner', {
            strategy: t(`strategy.${rerun.manifestStrategy.id}.name`),
            inPlace: rerun.organizedFileIds.length,
            new: rerun.newFileIds.length
          })}
        </Banner>
      )}

      {scan && rerun?.nothingToDo && (
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center">
          <Sparkles size={32} className="text-new" aria-hidden />
          <div className="text-lg font-medium">{t('scan.rerun.alreadyOrganized')}</div>
          <p className="max-w-md text-sm text-ink-secondary">{t('scan.rerun.alreadyOrganizedHint')}</p>
          <div className="mt-2 flex gap-2">
            <Button
              onClick={() => {
                setReorganizeEverything(true)
                goTo('strategy')
              }}
            >
              {t('scan.rerun.reorganizeEverything')}
            </Button>
          </div>
          <p className="text-xs text-ink-faint">
            {t('home.recentOrganized', { when: formatRelative(rerun.lastAppliedAt) })}
          </p>
        </div>
      )}

      {scan && !rerun?.nothingToDo && scan.files.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-sm text-ink-secondary">
          {t('scan.emptyFolder')}
        </div>
      )}

      {scan && !rerun?.nothingToDo && scan.files.length > 0 && (
        <>
          {scan.dirs.length > 0 ? (
            <section className="flex min-h-0 flex-1 flex-col rounded-xl border border-line bg-surface-1">
              <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
                <div>
                  <h2 className="text-sm font-medium">{t('scan.subfolderTitle')}</h2>
                  <p className="text-xs text-ink-faint">{t('scan.subfolderHint')}</p>
                </div>
                <div className="flex gap-1">
                  <Button size="sm" variant="ghost" onClick={includeAllDirs}>
                    {t('scan.includeAll')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={skipAllDirs}>
                    {t('scan.skipAll')}
                  </Button>
                </div>
              </div>
              <FolderTree
                rows={rows}
                mode="inclusion"
                expanded={expanded}
                onToggleExpand={onToggleExpand}
                checkState={checkState}
                onCheck={(row, next) => toggleInclusion(row.path, next)}
                className="flex-1 py-1"
                ariaLabel={t('scan.subfolderTitle')}
                trailing={(row) =>
                  checkState(row) === 'unchecked' ? (
                    <span className="rounded bg-surface-2 px-1.5 text-[10px] text-ink-faint">
                      {t('scan.skippedBadge')}
                    </span>
                  ) : row.badge === 'managed' ? (
                    <span className="rounded bg-accent-soft px-1.5 text-[10px] text-accent">
                      {t('scan.managedBadge')}
                    </span>
                  ) : null
                }
              />
            </section>
          ) : (
            <div className="flex-1" />
          )}
        </>
      )}

      {/*
        Always reachable, including while scanning and when the folder turns
        out to be empty — otherwise those states are dead ends with no way
        back to the picker.
      */}
      <footer className="mt-auto flex items-center justify-between gap-3 pt-2">
        <div className="flex min-w-0 items-center gap-3">
          <Button variant="ghost" onClick={startOver}>
            <ArrowLeft size={14} aria-hidden />
            {t('scan.chooseAnotherFolder')}
          </Button>
          {hasFilesToOrganize && (
            <span className="truncate text-sm text-ink-secondary">
              {t('scan.willAnalyze', { count: includedFiles })}
            </span>
          )}
        </div>
        {hasFilesToOrganize && (
          <Button variant="primary" disabled={includedFiles === 0} onClick={() => goTo('strategy')}>
            {t('scan.chooseStrategy')}
          </Button>
        )}
      </footer>
    </div>
  )
}
