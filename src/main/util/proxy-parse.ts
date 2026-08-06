/**
 * Parse a Chromium proxy resolution string ("DIRECT", "PROXY host:port",
 * "HTTPS host:port; DIRECT", …) into a proxy URL usable as HTTP(S)_PROXY.
 * SOCKS entries are skipped — neither undici nor the Claude CLI honor
 * socks:// env proxies; a later DIRECT/PROXY entry may still match.
 */
export function parseProxyResolution(resolution: string): string | null {
  for (const part of resolution.split(';').map((s) => s.trim())) {
    if (/^DIRECT$/i.test(part)) return null
    const match = part.match(/^(PROXY|HTTPS)\s+(\S+)$/i)
    if (!match) continue
    const scheme = match[1].toUpperCase() === 'HTTPS' ? 'https' : 'http'
    return `${scheme}://${match[2]}`
  }
  return null
}
