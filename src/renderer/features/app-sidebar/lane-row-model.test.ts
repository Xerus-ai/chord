import { describe, expect, it } from 'vitest';
import {
  describeLaneDeleteConfirm,
  formatLaneRoute,
  pickLaneOpenTarget,
  planLaneRowActions,
} from './lane-row-model';

describe('formatLaneRoute', () => {
  it('reads "branch → target": where the lane merges is always on the row', () => {
    expect(formatLaneRoute({ branch: 'raghav/fix-x-a3f', targetRef: 'origin/main' })).toBe(
      'raghav/fix-x-a3f → origin/main'
    );
  });

  it('is the branch alone for a lane from before targets were recorded', () => {
    expect(formatLaneRoute({ branch: 'raghav/fix-x-a3f', targetRef: null })).toBe(
      'raghav/fix-x-a3f'
    );
  });

  it('is null when the checkout has no branch recorded', () => {
    expect(formatLaneRoute({ branch: null, targetRef: 'origin/main' })).toBeNull();
  });
});

describe('planLaneRowActions', () => {
  it('offers every action on a secondary lane', () => {
    expect(planLaneRowActions({ isPrimary: false, branch: 'raghav/fix-x-a3f--2' })).toEqual({
      promote: { enabled: true },
      copyBranch: { enabled: true },
      archive: { enabled: true },
      delete: { enabled: true },
    });
  });

  it('shows Delete and Archive on the primary disabled, with why', () => {
    const actions = planLaneRowActions({ isPrimary: true, branch: 'raghav/fix-x-a3f' });
    expect(actions.delete).toEqual({
      enabled: false,
      reason: 'Promote another branch first, or delete the work item',
    });
    expect(actions.archive).toEqual({
      enabled: false,
      reason: 'The work item opens to its primary branch',
    });
    expect(actions.promote).toEqual({ enabled: false, reason: 'Already the primary branch' });
    expect(actions.copyBranch).toEqual({ enabled: true });
  });

  it('cannot copy a branch name the lane does not have', () => {
    expect(planLaneRowActions({ isPrimary: false, branch: null }).copyBranch).toEqual({
      enabled: false,
      reason: 'No branch is recorded for this checkout',
    });
  });
});

describe('describeLaneDeleteConfirm', () => {
  const branch = 'raghav/fix-x-a3f--2';

  it('names the uncommitted changes that will be lost and the unpushed commits that stay local', () => {
    expect(
      describeLaneDeleteConfirm({ branch, inspection: { uncommitted: 3, unpushed: 2 } })
    ).toEqual({
      title: `Delete ${branch}?`,
      description:
        "Removes this branch's checkout and its sessions from this machine. The branch and its commits stay in the repository. " +
        '3 uncommitted changes in the checkout will be lost. ' +
        "2 commits aren't pushed: they stay on the branch on this machine only.",
    });
  });

  it('says when the branch was never pushed, and uses the singular for one change', () => {
    expect(
      describeLaneDeleteConfirm({ branch, inspection: { uncommitted: 1, unpushed: null } })
        .description
    ).toBe(
      "Removes this branch's checkout and its sessions from this machine. The branch and its commits stay in the repository. " +
        '1 uncommitted change in the checkout will be lost. ' +
        'The branch has never been pushed: its commits are on this machine only.'
    );
  });

  it('adds nothing to a clean, pushed lane', () => {
    expect(
      describeLaneDeleteConfirm({ branch, inspection: { uncommitted: 0, unpushed: 0 } }).description
    ).toBe(
      "Removes this branch's checkout and its sessions from this machine. The branch and its commits stay in the repository."
    );
  });

  it('titles a lane with no recorded branch by what it is', () => {
    expect(
      describeLaneDeleteConfirm({ branch: null, inspection: { uncommitted: 0, unpushed: 0 } }).title
    ).toBe('Delete this checkout?');
  });
});

describe('pickLaneOpenTarget', () => {
  const secondary = { id: 'lane-2', isPrimary: false };
  const primary = { id: 'lane-1', isPrimary: true };

  it("focuses the lane's most recently active running session", () => {
    expect(
      pickLaneOpenTarget(secondary, [
        { id: 's-old', worktreeId: 'lane-2', status: 'active', lastActiveAt: 10 },
        { id: 's-new', worktreeId: 'lane-2', status: 'suspended', lastActiveAt: 20 },
        { id: 's-other-lane', worktreeId: 'lane-1', status: 'active', lastActiveAt: 99 },
        { id: 's-ended', worktreeId: 'lane-2', status: 'done', lastActiveAt: 50 },
      ])
    ).toEqual({ kind: 'session', sessionId: 's-new' });
  });

  it('counts a session with no lane recorded as the primary lane’s', () => {
    expect(
      pickLaneOpenTarget(primary, [
        { id: 's-legacy', worktreeId: null, status: 'active', lastActiveAt: 5 },
      ])
    ).toEqual({ kind: 'session', sessionId: 's-legacy' });
    expect(
      pickLaneOpenTarget(secondary, [
        { id: 's-legacy', worktreeId: null, status: 'active', lastActiveAt: 5 },
      ])
    ).toEqual({ kind: 'new-terminal' });
  });

  it('opens a terminal in a lane with nothing running, so the item opens focused on it', () => {
    expect(
      pickLaneOpenTarget(secondary, [
        { id: 's-ended', worktreeId: 'lane-2', status: 'done', lastActiveAt: 50 },
      ])
    ).toEqual({ kind: 'new-terminal' });
  });
});
