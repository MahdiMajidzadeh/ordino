import type { ScanResult } from '@shared/types'

/**
 * Main-process cache of completed scans, keyed by scanId. Analysis and apply
 * reference scans by id so the renderer never round-trips file lists back —
 * the untrusted renderer only sends ids and decisions, and main re-validates
 * everything against this source of truth.
 */
const scans = new Map<string, ScanResult>()
const MAX_CACHED = 4

export function rememberScan(scan: ScanResult): void {
  scans.set(scan.scanId, scan)
  while (scans.size > MAX_CACHED) {
    const oldest = scans.keys().next().value
    if (oldest === undefined) break
    scans.delete(oldest)
  }
}

export function getScan(scanId: string): ScanResult | undefined {
  return scans.get(scanId)
}
