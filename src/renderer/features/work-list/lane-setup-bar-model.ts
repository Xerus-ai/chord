import type { CheckoutOrigin } from '@shared/worktree-sources';

/**
 * The provisioning bar's line for a lane whose setup did not run. An adopted
 * checkout's setup never ran on its own (plan §Phase 3 slice 6); only a lane
 * Chord made can have had it declined with Don't run.
 */
export function describeSkippedSetup(lane: { checkoutOrigin: CheckoutOrigin }): string {
  return lane.checkoutOrigin === 'adopted'
    ? 'Adopted — setup not run'
    : "Setup skipped — you chose Don't run";
}
