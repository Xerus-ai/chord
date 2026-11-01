import { describe, expect, it } from 'vitest';
import { pickBranchPrefix } from './branch-prefix';

/** GitHub is asked only when username mode has no stored login yet. */
async function githubMustNotBeAsked(): Promise<string | null> {
  throw new Error('GitHub was asked for a login it did not need');
}

describe('the prefix a new chord-named branch gets (Settings › Git)', () => {
  it('is nothing in none mode', async () => {
    expect(
      await pickBranchPrefix(
        { branchPrefixMode: 'none', branchPrefix: 'team', branchPrefixUsername: 'octocat' },
        githubMustNotBeAsked
      )
    ).toEqual({ success: true, data: { prefix: '', learnedUsername: null } });
  });

  it('is the typed prefix in custom mode', async () => {
    expect(
      await pickBranchPrefix(
        { branchPrefixMode: 'custom', branchPrefix: 'team', branchPrefixUsername: 'octocat' },
        githubMustNotBeAsked
      )
    ).toEqual({ success: true, data: { prefix: 'team', learnedUsername: null } });
  });

  it('is the stored login in username mode, without asking GitHub again', async () => {
    expect(
      await pickBranchPrefix(
        { branchPrefixMode: 'username', branchPrefix: 'chord', branchPrefixUsername: 'octocat' },
        githubMustNotBeAsked
      )
    ).toEqual({ success: true, data: { prefix: 'octocat', learnedUsername: null } });
  });

  it("is the signed-in user's GitHub login the first time, returned so it is stored", async () => {
    expect(
      await pickBranchPrefix(
        { branchPrefixMode: 'username', branchPrefix: 'chord', branchPrefixUsername: null },
        async () => 'hubot'
      )
    ).toEqual({ success: true, data: { prefix: 'hubot', learnedUsername: 'hubot' } });
  });

  it('refuses in username mode when GitHub is not connected, naming where to fix it', async () => {
    const result = await pickBranchPrefix(
      { branchPrefixMode: 'username', branchPrefix: 'chord', branchPrefixUsername: null },
      async () => null
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.type).toBe('branch_prefix_unavailable');
    expect(result.error.message).toContain('Settings › Git');
  });
});
