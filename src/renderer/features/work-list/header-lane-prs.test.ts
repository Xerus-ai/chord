import { describe, expect, it } from 'vitest';
import type { LanePr, LanePullRequest } from '@shared/lane-pull-requests';
import { listLanePrChips } from './header-lane-prs';

const REPO = 'https://github.com/acme/chord';

function pr(number: number, overrides: Partial<LanePr> = {}): LanePr {
  return {
    number,
    url: `${REPO}/pull/${number}`,
    title: `PR ${number}`,
    status: 'open',
    isDraft: false,
    headRefName: `branch-${number}`,
    baseRefName: 'main',
    headRefOid: 'a'.repeat(40),
    mergeableStatus: 'MERGEABLE',
    reviewDecision: null,
    checks: 'none',
    ...overrides,
  };
}

function lane(worktreeId: string, isPrimary: boolean, lanePr: LanePr | null): LanePullRequest {
  return {
    worktreeId,
    branchName: `raghav/${worktreeId}`,
    isPrimary,
    targetRef: 'origin/main',
    prBase: 'main',
    targetError: null,
    pr: lanePr,
  };
}

describe("listLanePrChips — the header lists every lane's PR", () => {
  const lanes = [
    lane('primary', true, pr(7, { checks: 'passing' })),
    lane('docs', false, null),
    lane('api', false, pr(12, { isDraft: true, checks: 'failing' })),
    lane('old-fix', false, pr(3, { status: 'merged', checks: 'pending' })),
  ];

  it('has one chip per lane with a PR, in lane order, primary first', () => {
    expect(listLanePrChips(lanes, 'primary').map((chip) => chip.number)).toEqual([7, 12, 3]);
  });

  it("carries each PR's number, state and checks, and the lane it focuses", () => {
    expect(listLanePrChips(lanes, 'primary')).toEqual([
      {
        worktreeId: 'primary',
        branchName: 'raghav/primary',
        number: 7,
        url: `${REPO}/pull/7`,
        state: 'open',
        checks: 'passing',
        focused: true,
      },
      {
        worktreeId: 'api',
        branchName: 'raghav/api',
        number: 12,
        url: `${REPO}/pull/12`,
        state: 'draft',
        checks: 'failing',
        focused: false,
      },
      {
        worktreeId: 'old-fix',
        branchName: 'raghav/old-fix',
        number: 3,
        url: `${REPO}/pull/3`,
        state: 'merged',
        checks: 'pending',
        focused: false,
      },
    ]);
  });

  it('marks the focused lane, wherever it is', () => {
    const chips = listLanePrChips(lanes, 'api');
    expect(chips.filter((chip) => chip.focused).map((chip) => chip.worktreeId)).toEqual(['api']);
  });

  it('is empty when no lane has a PR', () => {
    expect(listLanePrChips([lane('primary', true, null)], 'primary')).toEqual([]);
  });
});
