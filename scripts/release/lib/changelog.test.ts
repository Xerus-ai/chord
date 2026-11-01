import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSection, extractSection, insertSection, readRangeSubjects } from './changelog.ts';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A git repo with a commit per subject, in order, on main. */
function createRepo(subjects: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'changelog-'));
  temps.push(dir);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: dir, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'changelog-test');
  git('config', 'user.email', 'changelog-test@chord.invalid');
  subjects.forEach((subject, i) => {
    writeFileSync(join(dir, `f${i}.txt`), subject);
    git('add', '.');
    git('commit', '-q', '-m', subject);
  });
  return dir;
}

describe('buildSection', () => {
  it('groups a range by type under ## vX.Y.Z (date), without the release commit', () => {
    const section = buildSection('v1.1.0', '2026-10-19', [
      'fix(main): stop a lane run when its pty already exited (devstation-v1x2)',
      'chore(release): v1.0.0 (devstation-r1)',
      'feat(renderer): show what is new after an update (devstation-haay)',
      'perf(main): one git read per checkout (devstation-t0kl)',
      'ci: the lint step runs with a 4 GB heap, as the build does (devstation-rf8r)',
      'fix: an unscoped fix (devstation-ab12)',
    ]);

    expect(section).toBe(
      [
        '## v1.1.0 (2026-10-19)',
        '',
        '### Features',
        '',
        '- **renderer:** show what is new after an update (devstation-haay)',
        '',
        '### Fixes',
        '',
        '- **main:** stop a lane run when its pty already exited (devstation-v1x2)',
        '- an unscoped fix (devstation-ab12)',
        '',
        '### Performance',
        '',
        '- **main:** one git read per checkout (devstation-t0kl)',
        '',
        '### Other',
        '',
        '- the lint step runs with a 4 GB heap, as the build does (devstation-rf8r)',
        '',
      ].join('\n')
    );
  });

  it('refuses subjects that break the commit rule, naming each', () => {
    expect(() =>
      buildSection('v1.1.0', '2026-10-19', [
        'fix(main): a good one (devstation-v1x2)',
        'wip',
        'feat!: a breaking change (devstation-ab12)',
      ])
    ).toThrow(
      /2 commit subject\(s\) break the commit rule:\n {2}- wip\n {2}- feat!: a breaking change/
    );
  });

  it('refuses a version outside the tag grammar, vX.Y.Z or vX.Y.Z-canary.N', () => {
    const subjects = ['fix(main): a fix (devstation-cd34)'];
    for (const version of ['v1.0.0-rc1', 'v1.0.0+build.1', '1.0.0', 'v1.0']) {
      expect(() => buildSection(version, '2026-10-19', subjects)).toThrow(
        `not a release version (vX.Y.Z or vX.Y.Z-canary.N): ${version}`
      );
    }
    expect(buildSection('v1.0.0-canary.1', '2026-10-19', subjects)).toMatch(
      /^## v1\.0\.0-canary\.1 \(2026-10-19\)\n/
    );
  });

  it('refuses a date that is not YYYY-MM-DD', () => {
    expect(() =>
      buildSection('v1.1.0', '2026-10-1', ['fix(main): a fix (devstation-cd34)'])
    ).toThrow('not a date (YYYY-MM-DD): 2026-10-1');
  });

  it('refuses a range with nothing to release', () => {
    expect(() =>
      buildSection('v1.1.0', '2026-10-19', ['chore(release): v1.0.0 (devstation-r1)'])
    ).toThrow('no commits to release');
  });
});

describe('insertSection', () => {
  const v1 = buildSection('v1.0.0', '2026-10-18', [
    'feat(main): the first release (devstation-ab12)',
  ]);
  const v2 = buildSection('v1.1.0', '2026-10-19', ['fix(main): a fix (devstation-cd34)']);

  it('starts CHANGELOG.md with its header and puts a newer section first', () => {
    const first = insertSection(null, v1);
    expect(first.startsWith('# Changelog\n\n## v1.0.0 (2026-10-18)\n')).toBe(true);
    const second = insertSection(first, v2);
    expect(second.indexOf('## v1.1.0')).toBeLessThan(second.indexOf('## v1.0.0'));
    expect(second.startsWith('# Changelog\n\n## v1.1.0 (2026-10-19)\n')).toBe(true);
  });

  it('refuses a version already in the changelog', () => {
    expect(() => insertSection(insertSection(null, v1), v1)).toThrow(
      'CHANGELOG.md already has v1.0.0'
    );
  });
});

describe('extractSection', () => {
  const changelog = insertSection(
    insertSection(
      null,
      buildSection('v1.0.0', '2026-10-18', ['feat(main): the first release (devstation-ab12)'])
    ),
    buildSection('v1.1.0', '2026-10-19', ['fix(main): a fix (devstation-cd34)'])
  );

  it("returns a version's section without its heading, as release notes", () => {
    expect(extractSection(changelog, 'v1.0.0')).toBe(
      '### Features\n\n- **main:** the first release (devstation-ab12)\n'
    );
    expect(extractSection(changelog, 'v1.1.0')).toBe(
      '### Fixes\n\n- **main:** a fix (devstation-cd34)\n'
    );
  });

  it("returns a canary's section, and refuses a version outside the tag grammar", () => {
    const withCanary = insertSection(
      changelog,
      buildSection('v1.2.0-canary.1', '2026-10-20', ['perf(main): a canary (devstation-gh78)'])
    );
    expect(extractSection(withCanary, 'v1.2.0-canary.1')).toBe(
      '### Performance\n\n- **main:** a canary (devstation-gh78)\n'
    );
    expect(() => extractSection(withCanary, 'v1.1.0+x')).toThrow(
      'not a release version (vX.Y.Z or vX.Y.Z-canary.N): v1.1.0+x'
    );
  });

  it('refuses a version the changelog does not have', () => {
    expect(() => extractSection(changelog, 'v2.0.0')).toThrow(
      'CHANGELOG.md has no section for v2.0.0'
    );
  });
});

describe('readRangeSubjects', () => {
  it("reads a range's subjects, oldest first, without merge commits", () => {
    const repo = createRepo(['chore: seed (devstation-ab12)', 'fix(main): one (devstation-cd34)']);
    const git = (...args: string[]) =>
      execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
    const from = git('rev-parse', 'HEAD~1');
    git('checkout', '-q', '-b', 'topic');
    writeFileSync(join(repo, 'topic.txt'), 'topic');
    git('add', '.');
    git('commit', '-q', '-m', 'feat(renderer): two (devstation-ef56)');
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', 'Merge pull request #1 from topic', 'topic');

    expect(readRangeSubjects(from, 'HEAD', repo)).toEqual([
      'fix(main): one (devstation-cd34)',
      'feat(renderer): two (devstation-ef56)',
    ]);
  });

  it('reads a ref that looks like an option as a revision, not as a git log option', () => {
    const repo = createRepo(['chore: seed (devstation-ab12)']);
    const before = readdirSync(repo).sort();

    // As an option, git log would write its output to `<repo>/leak..HEAD`.
    expect(() => readRangeSubjects(`--output=${join(repo, 'leak')}`, 'HEAD', repo)).toThrow();
    expect(readdirSync(repo).sort()).toEqual(before);
  });
});
