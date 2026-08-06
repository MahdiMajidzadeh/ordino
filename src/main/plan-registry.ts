import type { Plan } from '@shared/types'

/** Completed plans by planId — export and apply cross-check against these. */
const plans = new Map<string, Plan>()
const MAX_CACHED = 4

export function rememberPlan(plan: Plan): void {
  plans.set(plan.planId, plan)
  while (plans.size > MAX_CACHED) {
    const oldest = plans.keys().next().value
    if (oldest === undefined) break
    plans.delete(oldest)
  }
}

export function getPlan(planId: string): Plan | undefined {
  return plans.get(planId)
}
