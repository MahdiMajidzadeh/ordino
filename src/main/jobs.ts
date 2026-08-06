import { randomUUID } from 'crypto'

/**
 * Registry of long-running jobs (analysis, apply) so `job:cancel` can abort
 * the scanner, hasher and provider through one AbortController.
 */
const jobs = new Map<string, AbortController>()

export interface Job {
  jobId: string
  signal: AbortSignal
}

export function createJob(): Job {
  const jobId = randomUUID()
  const controller = new AbortController()
  jobs.set(jobId, controller)
  return { jobId, signal: controller.signal }
}

export function cancelJob(jobId: string): void {
  jobs.get(jobId)?.abort()
}

export function finishJob(jobId: string): void {
  jobs.delete(jobId)
}
