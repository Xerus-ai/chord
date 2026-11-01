import { describe, expect, it } from 'vitest';
import { buildLaneEnvVars, type LaneEnvContext } from './envVars';

describe('buildLaneEnvVars', () => {
  const ctx: LaneEnvContext = {
    laneId: 'lane-1',
    workItemId: 'task-abc-123',
    workItemName: 'Fix Login Bug',
    checkoutPath: '/home/user/chord/worktrees/myapp/fix-login-bug',
    sourcePath: '/home/user/projects/myapp',
    targetRef: 'origin/main',
    portBase: 50120,
  };

  it('is one fixed contract', () => {
    expect(Object.keys(buildLaneEnvVars(ctx)).sort()).toEqual(
      [
        'CHORD_DEFAULT_BRANCH',
        'CHORD_LANE_ID',
        'CHORD_PORT',
        'CHORD_ROOT_PATH',
        'CHORD_SOURCE_PATH',
        'CHORD_TARGET_REF',
        'CHORD_TASK_ID',
        'CHORD_TASK_NAME',
        'CHORD_TASK_PATH',
      ].sort()
    );
  });

  it('points CHORD_ROOT_PATH at the checkout and CHORD_SOURCE_PATH at the main repo', () => {
    const vars = buildLaneEnvVars(ctx);
    expect(vars.CHORD_ROOT_PATH).toBe(ctx.checkoutPath);
    expect(vars.CHORD_TASK_PATH).toBe(ctx.checkoutPath);
    expect(vars.CHORD_SOURCE_PATH).toBe(ctx.sourcePath);
  });

  it('names the lane and where its PR merges', () => {
    const vars = buildLaneEnvVars(ctx);
    expect(vars.CHORD_LANE_ID).toBe('lane-1');
    expect(vars.CHORD_TASK_ID).toBe('task-abc-123');
    expect(vars.CHORD_TARGET_REF).toBe('origin/main');
    expect(vars.CHORD_DEFAULT_BRANCH).toBe('main');
  });

  it('uses a local target ref as the branch name as-is', () => {
    expect(buildLaneEnvVars({ ...ctx, targetRef: 'trunk' }).CHORD_DEFAULT_BRANCH).toBe('trunk');
  });

  it("uses the lane's allocated port block, never a hash", () => {
    expect(buildLaneEnvVars(ctx).CHORD_PORT).toBe('50120');
  });

  it('slugifies the work item name', () => {
    expect(buildLaneEnvVars(ctx).CHORD_TASK_NAME).toBe('fix-login-bug');
    expect(buildLaneEnvVars({ ...ctx, workItemName: '---Hello World---' }).CHORD_TASK_NAME).toBe(
      'hello-world'
    );
  });

  it('names an unnameable work item "task"', () => {
    expect(buildLaneEnvVars({ ...ctx, workItemName: '!!!' }).CHORD_TASK_NAME).toBe('task');
  });
});
