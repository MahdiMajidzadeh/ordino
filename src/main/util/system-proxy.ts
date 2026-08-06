import { session } from 'electron'
import { parseProxyResolution } from './proxy-parse'

/**
 * Adopt the OS-level proxy (macOS Network settings / Windows proxy / PAC)
 * into HTTP(S)_PROXY env vars when none are set yet. Chromium resolves the
 * system proxy natively, but the two things that actually talk to AI
 * providers — the spawned Claude CLI and Node's fetch — only understand env
 * vars. Without this, a user whose machine reaches Anthropic through a
 * configured system proxy works in Chrome but gets 403s from Ordino.
 */
export async function adoptSystemProxy(): Promise<string | null> {
  if (
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy
  ) {
    return null // explicit env proxy already present — respect it
  }
  let resolution: string
  try {
    resolution = await session.defaultSession.resolveProxy('https://api.anthropic.com/')
  } catch {
    return null
  }
  const proxyUrl = parseProxyResolution(resolution)
  if (!proxyUrl) return null

  process.env.HTTP_PROXY = proxyUrl
  process.env.HTTPS_PROXY = proxyUrl
  if (!process.env.NO_PROXY && !process.env.no_proxy) {
    process.env.NO_PROXY = 'localhost,127.0.0.1,::1'
  }
  return proxyUrl
}
