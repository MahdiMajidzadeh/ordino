import type { ReactNode } from 'react'
import { AlertTriangle, Info, XCircle } from 'lucide-react'

type Kind = 'info' | 'warning' | 'error'

const KIND_CLASSES: Record<Kind, string> = {
  info: 'bg-accent-soft text-ink border-accent/20',
  warning: 'bg-dupe-soft text-ink border-dupe/30',
  error: 'bg-danger-soft text-ink border-danger/30'
}

const KIND_ICON: Record<Kind, typeof Info> = {
  info: Info,
  warning: AlertTriangle,
  error: XCircle
}

export interface BannerProps {
  kind: Kind
  children: ReactNode
  /** Optional action buttons rendered on the trailing edge. */
  actions?: ReactNode
}

export function Banner({ kind, children, actions }: BannerProps): React.JSX.Element {
  const Icon = KIND_ICON[kind]
  return (
    <div
      role={kind === 'error' ? 'alert' : 'status'}
      className={`flex items-start gap-2.5 rounded-lg border px-3.5 py-2.5 text-sm ${KIND_CLASSES[kind]}`}
    >
      <Icon size={16} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </div>
  )
}
