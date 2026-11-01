import { describe, expect, it } from 'vitest';
import type { LanePr } from '@shared/lane-pull-requests';
import { toLanePrRow } from './lane-pr-row';

function pr(overrides: Partial<LanePr> = {}): LanePr {
  return {
    number: 12,
    url: 'https://github.com/acme/chord/pull/12',
    title: 'Login API',
    status: 'open',
    isDraft: false,
    headRefName: 'raghav/login--api',
    baseRefName: 'main',
    headRefOid: 'a'.repeat(40),
    mergeableStatus: 'MERGEABLE',
    reviewDecision: null,
    checks: 'none',
    ...overrides,
  };
}

describe("toLanePrRow — a lane row keeps the PR's badge", () => {
  it.each<[string, Partial<LanePr>, string]>([
    ['an open PR awaiting review', {}, 'In review'],
    ['an approved PR', { reviewDecision: 'APPROVED' }, 'Ready to merge'],
    ['a conflicting PR', { mergeableStatus: 'CONFLICTING' }, 'Conflicts'],
    ['a PR with changes requested', { reviewDecision: 'CHANGES_REQUESTED' }, 'Changes requested'],
    ['a draft', { isDraft: true }, 'Draft'],
    ['a merged PR', { status: 'merged' }, 'Merged'],
    ['a closed PR', { status: 'closed' }, 'Closed'],
  ])('shows %s as "%s"', (_name, overrides, badge) => {
    expect(toLanePrRow(pr(overrides))?.state).toBe(badge);
  });

  it("carries the PR's number and title", () => {
    expect(toLanePrRow(pr())).toMatchObject({ number: 12, title: 'Login API' });
  });

  it('is null for a lane without a PR', () => {
    expect(toLanePrRow(null)).toBeNull();
  });
});
