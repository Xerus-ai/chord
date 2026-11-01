import { describe, expect, it } from 'vitest';
import { describeArchivedLane, describeLaneArchiveConfirm } from './lane-archive-model';

describe('describeLaneArchiveConfirm', () => {
  const branch = 'raghav/fix-x-a3f--2';

  it('says what is kept: the branch, its history, and the uncommitted files', () => {
    expect(
      describeLaneArchiveConfirm({
        branch,
        inspection: { uncommitted: 3, unpushed: 0, branchDeletable: false },
      })
    ).toEqual({
      title: `Archive ${branch}?`,
      description:
        "Removes this branch's checkout from this machine. The branch, its commits and its chat history are kept, and Restore brings the checkout back. " +
        '3 uncommitted files are kept with the archive.',
      offerBranchDelete: false,
    });
  });

  it('uses the singular for one file, and adds nothing for a clean lane', () => {
    expect(
      describeLaneArchiveConfirm({
        branch,
        inspection: { uncommitted: 1, unpushed: 0, branchDeletable: false },
      }).description
    ).toContain('1 uncommitted file is kept with the archive.');
    expect(
      describeLaneArchiveConfirm({
        branch,
        inspection: { uncommitted: 0, unpushed: 0, branchDeletable: false },
      }).description
    ).not.toContain('uncommitted');
  });

  it('offers to delete a merged branch, saying nothing is lost', () => {
    const copy = describeLaneArchiveConfirm({
      branch,
      inspection: { uncommitted: 0, unpushed: 0, branchDeletable: true },
    });
    expect(copy.offerBranchDelete).toBe(true);
    expect(copy.description).toContain(
      'Its pull request is merged and the branch has nothing newer, so the branch can go too.'
    );
  });

  it('titles a lane with no recorded branch by what it is', () => {
    expect(
      describeLaneArchiveConfirm({
        branch: null,
        inspection: { uncommitted: 0, unpushed: 0, branchDeletable: false },
      }).title
    ).toBe('Archive this checkout?');
  });
});

describe('describeArchivedLane', () => {
  it('names the lane and what it keeps', () => {
    expect(
      describeArchivedLane({
        branchName: 'raghav/fix-x-a3f--2',
        title: 'retry flow',
        restorable: true,
        keptChanges: 2,
      })
    ).toEqual({ label: 'retry flow', detail: '2 uncommitted files kept', canRestore: true });
  });

  it('falls back to the branch, and says when nothing uncommitted was kept', () => {
    expect(
      describeArchivedLane({
        branchName: 'raghav/fix-x-a3f--2',
        title: null,
        restorable: true,
        keptChanges: 0,
      })
    ).toEqual({ label: 'raghav/fix-x-a3f--2', detail: 'Branch kept', canRestore: true });
  });

  it('offers only Delete once the branch is gone', () => {
    expect(
      describeArchivedLane({
        branchName: 'raghav/fix-x-a3f--2',
        title: null,
        restorable: false,
        keptChanges: 0,
      })
    ).toEqual({
      label: 'raghav/fix-x-a3f--2',
      detail: 'Branch deleted, nothing to restore',
      canRestore: false,
    });
  });
});
