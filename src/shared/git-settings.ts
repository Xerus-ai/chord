import type { GitChange } from './git';

/**
 * Settings › Git, as both processes read it (plan 2026-09-26, "Settings").
 *
 * `compareBase` is what a lane's committed changes are measured against:
 * `repoDefault` is where the lane merges (its `target_ref`), `upstream` is the
 * branch's own remote copy (where `git push` sends it), so only work not yet
 * pushed counts. PR and rebase targets never follow it.
 *
 * `sourceControlGroupOrder` is which group the Changes panel lists first
 * (one of `SOURCE_CONTROL_GROUP_ORDERS`).
 */
export const COMPARE_BASE_MODES = ['repoDefault', 'upstream'] as const;
export type CompareBaseMode = (typeof COMPARE_BASE_MODES)[number];

export const SOURCE_CONTROL_GROUP_ORDERS = ['changes', 'staged', 'untracked'] as const;
export type SourceControlGroupOrder = (typeof SOURCE_CONTROL_GROUP_ORDERS)[number];

/**
 * The base one lane is compared against. A branch with no remote copy — never
 * pushed, or its remote branch gone — is `no_upstream`, never the target ref
 * in disguise.
 */
export type LaneCompareBase =
  | { kind: 'ref'; mode: CompareBaseMode; ref: string }
  | { kind: 'no_upstream'; branch: string | null };

export type LaneCompareRef = Extract<LaneCompareBase, { kind: 'ref' }>;

/**
 * A lane's committed changes against its compare base, for the Changes panel.
 * With no upstream there is nothing to list, and the panel says why.
 */
export type LaneCommittedChanges =
  | (LaneCompareRef & { changes: GitChange[] })
  | Extract<LaneCompareBase, { kind: 'no_upstream' }>;
