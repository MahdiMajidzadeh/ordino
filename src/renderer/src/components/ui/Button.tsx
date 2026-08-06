import type { ButtonHTMLAttributes, ReactNode } from 'react'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'md' | 'sm'

const VARIANT_CLASSES: Record<Variant, string> = {
  primary:
    'bg-accent text-on-accent hover:bg-accent-strong disabled:opacity-40 disabled:hover:bg-accent',
  secondary:
    'bg-surface-2 text-ink border border-line hover:border-line-strong disabled:opacity-40',
  ghost: 'text-ink-secondary hover:bg-surface-2 hover:text-ink disabled:opacity-40',
  danger: 'bg-danger-soft text-danger hover:brightness-95 disabled:opacity-40'
}

const SIZE_CLASSES: Record<Size, string> = {
  md: 'h-9 px-4 text-sm rounded-lg gap-2',
  sm: 'h-7 px-2.5 text-xs rounded-md gap-1.5'
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  children: ReactNode
}

export function Button({
  variant = 'secondary',
  size = 'md',
  className = '',
  type = 'button',
  children,
  ...rest
}: ButtonProps): React.JSX.Element {
  return (
    <button
      type={type}
      className={`inline-flex items-center justify-center font-medium transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-accent ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  )
}
