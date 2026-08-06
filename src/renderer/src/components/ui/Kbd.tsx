export function Kbd({ children }: { children: string }): React.JSX.Element {
  return (
    <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded border border-line bg-surface-2 px-1 font-sans text-[11px] text-ink-secondary">
      {children}
    </kbd>
  )
}
