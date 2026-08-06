/**
 * Best-effort extraction of a JSON object from model text: strips markdown
 * fences and prose, finds the first balanced top-level {...} block. Models
 * behind arbitrary OpenAI-compatible endpoints get creative — this stage
 * rescues the recoverable cases before the repair round-trip.
 */
export function salvageJsonObject(text: string): string | null {
  let t = text.trim()

  // Strip a single fenced block if the whole payload is fenced.
  const fenceMatch = t.match(/^```(?:json)?\s*([\s\S]*?)\s*```\s*$/)
  if (fenceMatch) t = fenceMatch[1].trim()

  const start = t.indexOf('{')
  if (start === -1) return null

  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < t.length; i++) {
    const ch = t[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return t.slice(start, i + 1)
    }
  }
  return null
}

/** Rough streamed-progress signal: count move objects seen so far. */
export function countStreamedMoves(partialText: string): number {
  return (partialText.match(/"source"\s*:/g) ?? []).length
}
