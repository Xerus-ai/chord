import { describe, expect, it } from 'vitest';
import type { Worktree } from '@shared/worktrees';
import { companionChipLabel, focusedLaneCompanion } from './header-companion-model';

function lane(id: string, companionPath: string | null): Worktree {
  return {
    id,
    workItemId: 'item-1',
    path: `/pool/${id}/app`,
    branchName: `chord/${id}`,
    baseBranch: null,
    targetRef: null,
    setupStatus: null,
    forkSource: null,
    checkoutOrigin: 'chord',
    companionPath,
    isPrimary: id === 'a',
    title: null,
    createdAt: 0,
    archivedAt: null,
  };
}

describe('the header companion chip', () => {
  it("names the focused lane's companion checkout, and nothing for a lane without one", () => {
    const lanes = [lane('a', '/pool/a'), lane('b', null)];
    expect(focusedLaneCompanion(lanes, 'a')).toBe('/pool/a');
    expect(focusedLaneCompanion(lanes, 'b')).toBeNull();
    expect(focusedLaneCompanion(lanes, null)).toBeNull();
  });

  it('labels it by its last folder, with either separator', () => {
    expect(companionChipLabel('C:\\pool\\login')).toBe('login');
    expect(companionChipLabel('/pool/login/')).toBe('login');
  });
});
