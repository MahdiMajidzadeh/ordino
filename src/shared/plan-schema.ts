import { z } from 'zod'

/**
 * The raw contract both AI providers must produce (§ Agent design). Kept
 * deliberately loose on `reason` (models sometimes omit it) and strict on
 * shape everywhere else; semantic validation (paths exist, confinement,
 * no-rename) happens in main/plan/validate.ts.
 */
export const rawPlanSchema = z.object({
  newFolders: z.array(z.string().min(1)).default([]),
  moves: z
    .array(
      z.object({
        source: z.string().min(1),
        destination: z.string().min(1),
        reason: z.string().default('')
      })
    )
    .default([])
})

export type RawPlan = z.infer<typeof rawPlanSchema>

/** Input row sent to the model. `contentExcerpt` is reserved for P2-1. */
export interface AgentFileEntry {
  relPath: string
  name: string
  ext: string
  size: number
  createdAt: string
  modifiedAt: string
  contentExcerpt?: string
}
