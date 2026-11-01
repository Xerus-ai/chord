import { describe, expect, it } from 'vitest';
import { planWorktreeArchive, planWorktreeDelete, planWorktreePromotion } from './decisions';

describe('planWorktreeArchive', () => {
  it('refuses to archive the primary worktree', () => {
    const result = planWorktreeArchive({ isPrimary: true, archivedAt: null });
    expect(result).toEqual({ success: false, error: { type: 'primary_worktree' } });
  });

  it('refuses to archive an already-archived worktree', () => {
    const result = planWorktreeArchive({ isPrimary: false, archivedAt: 1_700_000_000 });
    expect(result).toEqual({ success: false, error: { type: 'already_archived' } });
  });

  it('allows archiving a non-primary, non-archived worktree', () => {
    const result = planWorktreeArchive({ isPrimary: false, archivedAt: null });
    expect(result.success).toBe(true);
  });
});

describe('planWorktreePromotion', () => {
  it('refuses to promote an archived worktree', () => {
    const result = planWorktreePromotion({ isPrimary: false, archivedAt: 1_700_000_000 });
    expect(result).toEqual({ success: false, error: { type: 'archived' } });
  });

  it('is a no-op when the worktree is already primary', () => {
    const result = planWorktreePromotion({ isPrimary: true, archivedAt: null });
    expect(result).toEqual({ success: true, data: 'already_primary' });
  });

  it('promotes a non-primary, non-archived worktree', () => {
    const result = planWorktreePromotion({ isPrimary: false, archivedAt: null });
    expect(result).toEqual({ success: true, data: 'promote' });
  });
});

describe('planWorktreeDelete', () => {
  const lanePath = 'C:\\worktrees\\repo\\fix-x-a3f';

  it('refuses the primary lane: the work item opens to it', () => {
    const result = planWorktreeDelete({ isPrimary: true, path: lanePath, isRepoCheckout: false });
    expect(result).toEqual({ success: false, error: { type: 'primary_worktree' } });
  });

  it("refuses a lane whose path is the repository's own checkout, naming the path", () => {
    const result = planWorktreeDelete({ isPrimary: false, path: lanePath, isRepoCheckout: true });
    expect(result).toEqual({ success: false, error: { type: 'repo_checkout', path: lanePath } });
  });

  it('names the primary refusal first when both apply', () => {
    const result = planWorktreeDelete({ isPrimary: true, path: lanePath, isRepoCheckout: true });
    expect(result).toEqual({ success: false, error: { type: 'primary_worktree' } });
  });

  it('allows a secondary lane on its own checkout', () => {
    const result = planWorktreeDelete({ isPrimary: false, path: lanePath, isRepoCheckout: false });
    expect(result).toEqual({ success: true, data: undefined });
  });
});
