import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderOpen, FolderClock } from 'lucide-react'
import type { RecentFolder } from '@shared/types'
import { ordino } from '../../api/client'
import { useApp } from '../../stores'
import { Button } from '../../components/ui/Button'
import { formatRelative } from '../../lib/format'

export function HomeScreen(): React.JSX.Element {
  const { t } = useTranslation()
  const selectFolder = useApp((s) => s.selectFolder)
  const [dragOver, setDragOver] = useState(false)
  const [dropError, setDropError] = useState(false)
  const [recents, setRecents] = useState<RecentFolder[]>([])

  useEffect(() => {
    void ordino.invoke('recents:list', undefined).then((res) => {
      if (res.ok) setRecents(res.data)
    })
  }, [])

  const browse = async (): Promise<void> => {
    const res = await ordino.invoke('dialog:pickFolder', undefined)
    if (res.ok && res.data) void selectFolder(res.data)
  }

  const onDrop = (e: React.DragEvent): void => {
    e.preventDefault()
    setDragOver(false)
    const item = e.dataTransfer.files[0]
    if (!item) return
    const path = ordino.getPathForFile(item)
    if (!path) {
      setDropError(true)
      return
    }
    setDropError(false)
    void selectFolder(path)
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-10 p-12">
      <div
        role="button"
        tabIndex={0}
        aria-label={t('home.dropTitle')}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') void browse()
        }}
        className={`flex w-full max-w-xl flex-col items-center gap-4 rounded-2xl border-2 border-dashed px-12 py-16 transition-colors ${
          dragOver ? 'border-accent bg-accent-soft' : 'border-line bg-surface-1'
        }`}
      >
        <FolderOpen size={40} strokeWidth={1.5} className={dragOver ? 'text-accent' : 'text-ink-faint'} aria-hidden />
        <div className="text-lg font-medium">{t('home.dropTitle')}</div>
        <div className="flex items-center gap-3 text-sm text-ink-secondary">
          {t('home.dropOr')}
          <Button variant="primary" onClick={() => void browse()}>
            {t('home.browse')}
          </Button>
        </div>
        {dropError && <div className="text-sm text-danger">{t('home.notAFolder')}</div>}
      </div>

      {recents.length > 0 && (
        <div className="w-full max-w-xl">
          <h2 className="mb-2 text-xs font-medium tracking-wide text-ink-faint uppercase">
            {t('home.recentTitle')}
          </h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface-1">
            {recents.map((r) => (
              <li key={r.path}>
                <button
                  type="button"
                  onClick={() => void selectFolder(r.path)}
                  className="flex w-full items-center gap-3 px-4 py-2.5 text-start transition-colors hover:bg-surface-2"
                >
                  <FolderClock size={16} className="shrink-0 text-ink-faint" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-ink-faint">{r.path}</span>
                  </span>
                  <span className="shrink-0 text-xs text-ink-faint">
                    {r.hasManifest
                      ? t('home.recentOrganized', { when: formatRelative(r.lastUsedAt) })
                      : t('home.recentNever')}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="text-xs text-ink-faint">{t('home.dropHint')}</p>
    </div>
  )
}
