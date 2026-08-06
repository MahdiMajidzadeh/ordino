const SIZE_UNITS = ['b', 'kb', 'mb', 'gb', 'tb'] as const

export function formatSize(bytes: number, t: (key: string) => string): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const rounded = unit === 0 ? Math.round(value) : value >= 100 ? Math.round(value) : value.toFixed(1)
  return `${rounded} ${t(`units.${SIZE_UNITS[unit]}`)}`
}

export function formatWhen(epochMs: number): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(epochMs)
  )
}

export function formatRelative(epochMs: number): string {
  const deltaSec = Math.round((epochMs - Date.now()) / 1000)
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const abs = Math.abs(deltaSec)
  if (abs < 60) return rtf.format(deltaSec, 'second')
  if (abs < 3600) return rtf.format(Math.round(deltaSec / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(deltaSec / 3600), 'hour')
  if (abs < 86400 * 30) return rtf.format(Math.round(deltaSec / 86400), 'day')
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(epochMs))
}

/** Middle-truncate long paths for display: "very/long/…/tail/file.pdf". */
export function truncatePath(path: string, max = 48): string {
  if (path.length <= max) return path
  const head = path.slice(0, Math.ceil(max / 2) - 1)
  const tail = path.slice(-(Math.floor(max / 2) - 1))
  return `${head}…${tail}`
}
