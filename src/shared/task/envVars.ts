/**
 * The environment every process Chord starts for a lane gets — setup and run
 * scripts, terminals, and every agent transport. One builder, so a script
 * sees the same values whichever path launched it.
 */
export interface LaneEnvContext {
  laneId: string;
  workItemId: string;
  workItemName: string;
  /** The lane's checkout — where the process runs. */
  checkoutPath: string;
  /** The repository's main checkout. */
  sourcePath: string;
  /** Where the lane's PR merges, e.g. `origin/main`. */
  targetRef: string;
  /** First port of the lane's allocated block. */
  portBase: number;
}

export function buildLaneEnvVars(ctx: LaneEnvContext): Record<string, string> {
  // `origin/main` → `main`. A slash-free target is a local branch already.
  const slash = ctx.targetRef.indexOf('/');
  const targetBranch = slash === -1 ? ctx.targetRef : ctx.targetRef.slice(slash + 1);
  return {
    CHORD_LANE_ID: ctx.laneId,
    CHORD_ROOT_PATH: ctx.checkoutPath,
    CHORD_SOURCE_PATH: ctx.sourcePath,
    CHORD_TARGET_REF: ctx.targetRef,
    CHORD_DEFAULT_BRANCH: targetBranch,
    CHORD_PORT: String(ctx.portBase),
    CHORD_TASK_ID: ctx.workItemId,
    CHORD_TASK_NAME: slugify(ctx.workItemName) || 'task',
    CHORD_TASK_PATH: ctx.checkoutPath,
  };
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
