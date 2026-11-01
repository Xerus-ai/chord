import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { nextReleaseTag, parseReleaseTag, readReleasePlan } from './release-plan.ts';

/**
 * The release plan (devstation-g98j, C3): which commits a release carries, the version they
 * add up to, and the tag grammar. The gate's notes phase reads it through release-plan.ts.
 */
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A repo whose commits carry `subjects` in turn; `tags` maps a subject's index to a tag. */
function createRepo(subjects: string[], tags: Record<number, string> = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'release-plan-'));
  temps.push(repo);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Release Plan Test');
  git('config', 'user.email', 'test@example.com');
  for (const [i, subject] of subjects.entries()) {
    writeFileSync(join(repo, `f${i}.txt`), `${i}\n`);
    git('add', '-A');
    git('commit', '-q', '-m', subject);
    if (tags[i]) git('tag', '-a', tags[i], '-m', tags[i]);
  }
  return { repo, git };
}

describe('nextReleaseTag', () => {
  it('starts at v1.0.0', () => {
    expect(nextReleaseTag(null, ['fix(main): a (t-1)'])).toBe('v1.0.0');
  });

  it('bumps the minor for a feature and the patch otherwise', () => {
    expect(nextReleaseTag('v1.2.3', ['fix(main): a (t-1)', 'chore: b (t-2)'])).toBe('v1.2.4');
    expect(nextReleaseTag('v1.2.3', ['fix(main): a (t-1)', 'feat(renderer): b (t-2)'])).toBe(
      'v1.3.0'
    );
  });

  it('refuses a major bump, by bang or by footer', () => {
    expect(() => nextReleaseTag('v1.2.3', ['feat!: breaking (t-1)'])).toThrow(/major/);
    expect(() => nextReleaseTag('v1.2.3', ['feat: a (t-1)\n\nBREAKING CHANGE: gone'])).toThrow(
      /major/
    );
  });

  it('refuses an empty range', () => {
    expect(() => nextReleaseTag('v1.2.3', [])).toThrow(/no commits/);
  });
});

describe('parseReleaseTag', () => {
  it('accepts vX.Y.Z and vX.Y.Z-canary.N', () => {
    expect(parseReleaseTag('v1.0.0')).toEqual({ major: 1, minor: 0, patch: 0, canary: null });
    expect(parseReleaseTag('v2.10.3-canary.4')).toEqual({
      major: 2,
      minor: 10,
      patch: 3,
      canary: 4,
    });
  });

  it('refuses every other shape', () => {
    for (const tag of [
      'v1.0.0-rc1',
      '1.0.0',
      'v1.0',
      'v1.0.0-canary',
      'v1.0.0-beta.1',
      'v01.0.0',
    ]) {
      expect(() => parseReleaseTag(tag), tag).toThrow(/not a release tag/);
    }
  });
});

describe('readReleasePlan', () => {
  it('reads every commit since the last stable tag and the version they add up to', () => {
    const { repo } = createRepo(
      ['chore: one (t-1)', 'feat(main): two (t-2)', 'fix(main): three (t-3)'],
      { 0: 'v1.0.0' }
    );

    const plan = readReleasePlan(repo);

    expect(plan.from).toBe('v1.0.0');
    expect(plan.tag).toBe('v1.1.0');
    expect(plan.commits.map((c) => c.subject)).toEqual([
      'feat(main): two (t-2)',
      'fix(main): three (t-3)',
    ]);
  });

  it('takes the whole history before the first release', () => {
    const { repo } = createRepo(['chore: one (t-1)', 'fix(main): two (t-2)']);

    const plan = readReleasePlan(repo);

    expect(plan.from).toBeNull();
    expect(plan.tag).toBe('v1.0.0');
    expect(plan.commits).toHaveLength(2);
  });

  it('refuses a range holding a commit that breaks the commit rule, naming each one', () => {
    const { repo, git } = createRepo(['chore: one (t-1)', 'wip', 'fix: no bead']);
    const wip = git('rev-parse', '--short=12', 'HEAD~1');

    expect(() => readReleasePlan(repo)).toThrow(new RegExp(`${wip} wip[\\s\\S]*fix: no bead`));
  });
});
