import { parseProvisionError } from '@shared/work-item-provision-error';

export interface ProvisionRetryPlan {
  /** Use the checkout an interrupted create left in the pool (`lane-checkout.ts`). */
  resumeInterrupted: boolean;
}

/**
 * How a Retry repeats provisioning, from the failure stored on the row
 * (devstation-dq2). Only an `interrupted` create can have left a finished
 * `git worktree add` behind with no row pointing at it; every other failure
 * retries the create as asked, so an existing branch stays refused. A stored
 * value that is not a typed error throws (`parseProvisionError`).
 */
export function planProvisionRetry(row: { provisionError: string | null }): ProvisionRetryPlan {
  if (row.provisionError === null) return { resumeInterrupted: false };
  return { resumeInterrupted: parseProvisionError(row.provisionError).type === 'interrupted' };
}
