import { describe, expect, it } from 'vitest';
import { derivePrBadge, derivePrState, type PrBadgeInput } from '@shared/pr-status-badge';

function pr(overrides: Partial<PrBadgeInput> = {}): PrBadgeInput {
  return {
    status: 'open',
    isDraft: 0,
    mergeableStatus: 'MERGEABLE',
    reviewDecision: null,
    ...overrides,
  };
}

describe('derivePrState', () => {
  it('reports a merged PR as merged regardless of its review state', () => {
    expect(derivePrState(pr({ status: 'merged', reviewDecision: 'CHANGES_REQUESTED' }))).toBe(
      'merged'
    );
  });

  it('reports a closed PR as closed', () => {
    expect(derivePrState(pr({ status: 'closed' }))).toBe('closed');
  });

  it('prefers draft over review state', () => {
    expect(derivePrState(pr({ isDraft: 1, reviewDecision: 'APPROVED' }))).toBe('draft');
  });

  it('prefers conflicts over an approving review', () => {
    expect(derivePrState(pr({ mergeableStatus: 'CONFLICTING', reviewDecision: 'APPROVED' }))).toBe(
      'conflicts'
    );
  });

  it('reports requested changes', () => {
    expect(derivePrState(pr({ reviewDecision: 'CHANGES_REQUESTED' }))).toBe('changes_requested');
  });

  it('reports an approved, mergeable PR as ready to merge', () => {
    expect(derivePrState(pr({ reviewDecision: 'APPROVED' }))).toBe('ready_to_merge');
  });

  it('falls back to in review when nothing has been decided', () => {
    expect(derivePrState(pr())).toBe('in_review');
  });
});

describe('derivePrBadge', () => {
  it('is the display word for the state the ladder derived', () => {
    const inputs: PrBadgeInput[] = [
      pr({ status: 'merged' }),
      pr({ status: 'closed' }),
      pr({ isDraft: 1 }),
      pr({ mergeableStatus: 'CONFLICTING' }),
      pr({ reviewDecision: 'CHANGES_REQUESTED' }),
      pr({ reviewDecision: 'APPROVED' }),
      pr(),
    ];
    expect(inputs.map(derivePrState)).toEqual([
      'merged',
      'closed',
      'draft',
      'conflicts',
      'changes_requested',
      'ready_to_merge',
      'in_review',
    ]);
    expect(inputs.map(derivePrBadge)).toEqual([
      'Merged',
      'Closed',
      'Draft',
      'Conflicts',
      'Changes requested',
      'Ready to merge',
      'In review',
    ]);
  });

  it('reports a merged PR as merged regardless of its review state', () => {
    expect(derivePrBadge(pr({ status: 'merged', reviewDecision: 'CHANGES_REQUESTED' }))).toBe(
      'Merged'
    );
  });

  it('reports a closed PR as closed', () => {
    expect(derivePrBadge(pr({ status: 'closed' }))).toBe('Closed');
  });

  it('prefers draft over review state', () => {
    expect(derivePrBadge(pr({ isDraft: 1, reviewDecision: 'APPROVED' }))).toBe('Draft');
  });

  it('prefers conflicts over an approving review', () => {
    expect(derivePrBadge(pr({ mergeableStatus: 'CONFLICTING', reviewDecision: 'APPROVED' }))).toBe(
      'Conflicts'
    );
  });

  it('reports requested changes', () => {
    expect(derivePrBadge(pr({ reviewDecision: 'CHANGES_REQUESTED' }))).toBe('Changes requested');
  });

  it('reports an approved, mergeable PR as ready to merge', () => {
    expect(derivePrBadge(pr({ reviewDecision: 'APPROVED' }))).toBe('Ready to merge');
  });

  it('falls back to in review when nothing has been decided', () => {
    expect(derivePrBadge(pr())).toBe('In review');
  });
});
