import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { budgetDiffSections, PENDING_SECTION_LABEL } from './diff-budget';
import { readPullRequestInput } from './git-ai-inputs';
import { buildPullRequestPrompt } from './git-ai-prompts';

function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, { cwd, encoding: 'utf8' });
}

const lines = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, i) => `${prefix} line ${i + 1}`).join('\n') + '\n';

/**
 * A lane as Create PR finds it: two commits of its own (one large) and
 * uncommitted work it will commit before opening the PR — an edited tracked
 * file and a new one. The PR text covers both, in one budget.
 */
let root: string;
let input: Awaited<ReturnType<typeof readPullRequestInput>>;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-git-ai-pr-budget-'));
  git(root, 'init', '-q', '-b', 'main');
  git(root, 'config', 'user.email', 'test@chord.invalid');
  git(root, 'config', 'user.name', 'Chord test');
  fs.writeFileSync(path.join(root, 'README.md'), '# repo\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'base');

  git(root, 'checkout', '-q', '-b', 'raghav/login');
  fs.writeFileSync(path.join(root, 'big.ts'), lines('big', 400));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'Add the big module');
  fs.writeFileSync(path.join(root, 'login.ts'), lines('login', 20));
  git(root, 'add', '-A');
  git(root, 'commit', '-q', '-m', 'Add login');

  fs.writeFileSync(path.join(root, 'login.ts'), `${lines('login', 20)}pending edit\n`);
  fs.writeFileSync(path.join(root, 'pending-new.ts'), lines('pending', 30));
  input = await readPullRequestInput(root, 'main');
});

afterAll(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const sections = () => [
  { label: null, diff: input.diff },
  { label: PENDING_SECTION_LABEL, diff: input.pendingDiff },
];

describe('budgetDiffSections — commits plus the changes Create PR will commit', () => {
  it('within the budget: both diffs whole, the uncommitted ones under their own heading', () => {
    const budgeted = budgetDiffSections(sections(), 1_000_000);
    expect(budgeted.cut).toBe(false);
    expect(budgeted.text).toContain('+big line 400');
    expect(budgeted.text).toContain(PENDING_SECTION_LABEL);
    expect(budgeted.text.indexOf(PENDING_SECTION_LABEL)).toBeLessThan(
      budgeted.text.indexOf('+pending line 30')
    );
    expect(budgeted.text).toContain('+pending edit');
  });

  it('counts every file of both sections in the stats', () => {
    const paths = budgetDiffSections(sections(), 1_000_000).files.map((file) => file.path);
    expect(paths).toEqual(expect.arrayContaining(['big.ts', 'login.ts', 'pending-new.ts']));
  });

  it('over the budget: one budget across both, the stats of both kept, the large hunk dropped', () => {
    const budget = 5_000;
    const budgeted = budgetDiffSections(sections(), budget);
    expect(budgeted.cut).toBe(true);
    expect(budgeted.text.length).toBeLessThanOrEqual(budget);
    expect(budgeted.text).toContain('big.ts');
    expect(budgeted.text).toContain('pending-new.ts');
    expect(budgeted.text).toContain(PENDING_SECTION_LABEL);
    expect(budgeted.text).toContain('+pending line 30');
    expect(budgeted.text).not.toContain('+big line 400');
  });

  it('has no pending heading when nothing is uncommitted', () => {
    const budgeted = budgetDiffSections(
      [
        { label: null, diff: input.diff },
        { label: PENDING_SECTION_LABEL, diff: '' },
      ],
      1_000_000
    );
    expect(budgeted.text).not.toContain(PENDING_SECTION_LABEL);
  });

  it('the PR prompt tells the agent those changes will be committed with this PR', () => {
    const prompt = buildPullRequestPrompt({
      branch: input.branch,
      base: 'main',
      commits: input.commits,
      diff: budgetDiffSections(sections(), 1_000_000),
      template: null,
      instructions: '',
    });
    expect(prompt).toMatch(/will be committed with this PR/i);
    expect(prompt).toContain('+pending edit');
  });
});
