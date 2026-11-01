import { describe, expect, it } from 'vitest';
import { budgetDiff } from './diff-budget';
import { buildCommitPrompt, buildPullRequestPrompt } from './git-ai-prompts';

const DIFF = [
  'diff --git a/src/login.ts b/src/login.ts',
  'index 1111111..2222222 100644',
  '--- a/src/login.ts',
  '+++ b/src/login.ts',
  '@@ -1,2 +1,3 @@',
  ' export function login() {',
  '+  redirectToDashboard();',
  ' }',
  '',
].join('\n');

const whole = budgetDiff(DIFF, 10_000);
const cut = { ...budgetDiff(DIFF, 10_000), cut: true, omittedHunks: 3 };

/**
 * What the user's agent is asked. It gets the change and nothing else: no
 * tools, no files, so the prompt carries everything it may use, the user's
 * own instructions, and — when the diff was over budget — that it was cut.
 */
describe('buildCommitPrompt', () => {
  it('carries the diff and the branch, and asks for the message text only', () => {
    const prompt = buildCommitPrompt({ branch: 'raghav/login', diff: whole, instructions: '' });
    expect(prompt).toContain('+  redirectToDashboard();');
    expect(prompt).toContain('raghav/login');
    expect(prompt).toMatch(/only the commit message/i);
  });

  it("includes the user's commit instructions when set, and no instructions section when not", () => {
    const withInstructions = buildCommitPrompt({
      branch: 'raghav/login',
      diff: whole,
      instructions: 'Use Conventional Commits.',
    });
    expect(withInstructions).toContain('Use Conventional Commits.');
    expect(withInstructions).toMatch(/instructions/i);

    const without = buildCommitPrompt({ branch: 'raghav/login', diff: whole, instructions: '  ' });
    expect(without).not.toMatch(/user's instructions/i);
  });

  it('says the diff was cut when it was over budget, and not otherwise', () => {
    expect(buildCommitPrompt({ branch: null, diff: cut, instructions: '' })).toMatch(
      /diff was cut/i
    );
    expect(buildCommitPrompt({ branch: null, diff: whole, instructions: '' })).not.toMatch(
      /diff was cut/i
    );
  });

  it('names a detached checkout instead of a branch', () => {
    expect(buildCommitPrompt({ branch: null, diff: whole, instructions: '' })).toMatch(/detached/i);
  });
});

describe('buildPullRequestPrompt', () => {
  const base = {
    branch: 'raghav/login',
    base: 'main',
    commits: 'abc1234 Redirect to the dashboard after login\ndef5678 Add login test',
    diff: whole,
    template: null,
    instructions: '',
  };

  it('carries the commits, the diff, head and base, and asks for JSON with title and body', () => {
    const prompt = buildPullRequestPrompt(base);
    expect(prompt).toContain('abc1234 Redirect to the dashboard after login');
    expect(prompt).toContain('def5678 Add login test');
    expect(prompt).toContain('+  redirectToDashboard();');
    expect(prompt).toContain('raghav/login');
    expect(prompt).toContain('main');
    expect(prompt).toMatch(/"title"/);
    expect(prompt).toMatch(/"body"/);
  });

  it("includes the repository's PR template and asks the body to follow it", () => {
    const prompt = buildPullRequestPrompt({
      ...base,
      template: '## Summary\n\n## Test plan\n- [ ] Tested locally',
    });
    expect(prompt).toContain('## Test plan');
    expect(prompt).toMatch(/template/i);
  });

  it('has no template section without a template', () => {
    expect(buildPullRequestPrompt(base)).not.toMatch(/pull request template/i);
  });

  it("includes the user's PR instructions when set", () => {
    const prompt = buildPullRequestPrompt({ ...base, instructions: 'Link the Jira ticket.' });
    expect(prompt).toContain('Link the Jira ticket.');
  });

  it('says the diff was cut when it was over budget', () => {
    expect(buildPullRequestPrompt({ ...base, diff: cut })).toMatch(/diff was cut/i);
    expect(buildPullRequestPrompt(base)).not.toMatch(/diff was cut/i);
  });
});
