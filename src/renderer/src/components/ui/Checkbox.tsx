import { useEffect, useRef } from 'react'

export interface CheckboxProps {
  state: 'checked' | 'unchecked' | 'indeterminate'
  onChange: (next: boolean) => void
  label?: string
  stopPropagation?: boolean
}

export function Checkbox({ state, onChange, label, stopPropagation = true }: CheckboxProps): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === 'indeterminate'
  }, [state])

  return (
    <input
      ref={ref}
      type="checkbox"
      aria-label={label}
      checked={state === 'checked'}
      onClick={stopPropagation ? (e) => e.stopPropagation() : undefined}
      onChange={(e) => onChange(e.target.checked)}
      className="size-3.5 shrink-0 cursor-pointer rounded border-line accent-[var(--ord-accent)]"
    />
  )
}
