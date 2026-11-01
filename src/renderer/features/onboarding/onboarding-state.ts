import type { AgentProviderDefinition } from '@shared/agent-provider-registry';

/**
 * Splits the agent registry into the two groups the onboarding grid renders.
 *
 * The grid used to be one flat list with detected providers appended by the
 * not-yet-installed ones, distinguished only by a 6px dot — unreadable at 24
 * cards. Grouping makes installed-ness structural, so no per-card flag is
 * needed.
 *
 * `onMachine` preserves the order it was given (CLI-detected first, then
 * harness-only); `installable` is every remaining detectable provider.
 */
export function partitionAgents(
  detected: AgentProviderDefinition[],
  all: AgentProviderDefinition[]
): { onMachine: AgentProviderDefinition[]; installable: AgentProviderDefinition[] } {
  const detectedIds = new Set(detected.map((p) => p.id));
  return {
    onMachine: detected,
    installable: all.filter((p) => !detectedIds.has(p.id)),
  };
}

export interface OnboardingStepProgress {
  done: boolean;
  /** Excluded from the remaining count; still lifted once the rest are done. */
  optional: boolean;
  /** Running on its own (the agent scan) — nothing for the user to act on. */
  pending: boolean;
}

/**
 * What the single-page onboarding shows at the top and which section it
 * lifts. `nextIndex` is the first step the user can act on, so a step that
 * is still pending never takes the emphasis away from one they can do now.
 */
export function summarizeProgress(steps: OnboardingStepProgress[]): {
  remaining: number;
  total: number;
  nextIndex: number | null;
} {
  const required = steps.filter((step) => !step.optional);
  const nextIndex = steps.findIndex((step) => !step.done && !step.pending);
  return {
    remaining: required.filter((step) => !step.done).length,
    total: required.length,
    nextIndex: nextIndex === -1 ? null : nextIndex,
  };
}
