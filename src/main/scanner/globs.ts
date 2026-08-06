import picomatch from 'picomatch'

export const DEFAULT_IGNORE_GLOBS = ['node_modules', '.git', '*.tmp']

export type IgnoreMatcher = (relPath: string, name: string) => boolean

/**
 * Compile user ignore globs once per scan. A pattern matches either the
 * entry's bare name (`node_modules`, `*.tmp`) or its root-relative path
 * (`build/**`). Matched directories are pruned from recursion entirely.
 */
export function compileIgnoreGlobs(globs: readonly string[]): IgnoreMatcher {
  const cleaned = globs.map((g) => g.trim()).filter((g) => g.length > 0)
  if (cleaned.length === 0) return () => false
  const isMatch = picomatch(cleaned, { dot: true, nocase: true })
  return (relPath, name) => isMatch(name) || isMatch(relPath)
}
