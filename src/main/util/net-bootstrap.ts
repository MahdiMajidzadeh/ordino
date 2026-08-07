import { EnvHttpProxyAgent, setGlobalDispatcher } from 'undici'
import { hydrateProcessEnv } from './shell-env'
import { adoptSystemProxy } from './system-proxy'

/**
 * Adopting the shell environment means spawning a login shell, which is slow
 * and — on a badly behaved rc file — arbitrarily slow. Blocking window
 * creation on it turns a sluggish shell into an app that appears not to
 * launch, so this runs alongside startup instead.
 *
 * Nothing that needs the network happens until the user has picked a folder
 * and chosen a strategy, so awaiting `networkReady()` at the provider
 * boundary is enough to keep the ordering correct without a blank window.
 */
let bootstrap: Promise<void> | null = null

export function startNetworkBootstrap(): void {
  if (bootstrap) return
  bootstrap = (async () => {
    await hydrateProcessEnv()
    await adoptSystemProxy()
    const proxy =
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy
    if (proxy) setGlobalDispatcher(new EnvHttpProxyAgent())
    console.log(`[ordino] outbound proxy: ${proxy ?? 'none'}`)
  })().catch((e) => {
    // Never fatal: without a proxy the app still works on direct connections.
    console.error('[ordino] network bootstrap failed', e)
  })
}

export function networkReady(): Promise<void> {
  return bootstrap ?? Promise.resolve()
}
