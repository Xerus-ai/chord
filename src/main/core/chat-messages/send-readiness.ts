import type { AgentStartMode } from '@main/core/repo-config/resolve-repo-config';
import type { LaneReadiness } from '@main/core/worktrees/lane-readiness';

/**
 * Whether a message can reach an agent in its lane now.
 *
 * Until provisioning lands the work item's path is the SHARED repo root, so
 * nothing may run yet — the message waits for the checkout. With the
 * repository's `agentStart` at `waitForSetup` (the default) it also waits for
 * setup to succeed: an agent's first turn in a checkout whose dependencies are
 * still installing fails in confusing ways. A failed setup keeps it waiting
 * until a Retry succeeds. A checkout that could not be created at all has
 * nowhere to run: refused.
 */
export type SendReadiness =
  | { kind: 'deliver' }
  | { kind: 'wait'; until: LaneReadiness }
  | { kind: 'refuse' };

export function decideSendReadiness(args: {
  provisionStatus: string;
  setupStatus: string | null;
  agentStart: AgentStartMode;
}): SendReadiness {
  if (args.provisionStatus === 'failed') return { kind: 'refuse' };
  const waitsForSetup = args.agentStart === 'waitForSetup';
  if (args.provisionStatus !== 'ready') {
    return { kind: 'wait', until: waitsForSetup ? 'setup' : 'checkout' };
  }
  // Skipped: the user chose Don't run for setup — agents start without it.
  const setupSettled =
    args.setupStatus === null || args.setupStatus === 'ok' || args.setupStatus === 'skipped';
  if (waitsForSetup && !setupSettled) {
    return { kind: 'wait', until: 'setup' };
  }
  return { kind: 'deliver' };
}
