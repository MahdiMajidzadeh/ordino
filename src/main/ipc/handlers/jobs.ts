import { z } from 'zod'
import { handle } from '../typed-ipc'
import { cancelJob } from '../../jobs'

export function registerJobHandlers(): void {
  handle('job:cancel', z.object({ jobId: z.string().min(1) }), async ({ jobId }) => {
    cancelJob(jobId)
  })
}
