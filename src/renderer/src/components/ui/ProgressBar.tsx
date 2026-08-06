export interface ProgressBarProps {
  /** 0..1; undefined renders an indeterminate shimmer. */
  fraction?: number
  className?: string
}

export function ProgressBar({ fraction, className = '' }: ProgressBarProps): React.JSX.Element {
  const clamped = fraction === undefined ? undefined : Math.max(0, Math.min(1, fraction))
  return (
    <div
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped === undefined ? undefined : Math.round(clamped * 100)}
      className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-2 ${className}`}
    >
      {clamped === undefined ? (
        <div className="h-full w-1/3 animate-pulse rounded-full bg-accent" />
      ) : (
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
          style={{ width: `${clamped * 100}%` }}
        />
      )}
    </div>
  )
}
