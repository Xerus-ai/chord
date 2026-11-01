import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const HERE = dirname(fileURLToPath(import.meta.url));
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Runs a release script with node, as release.yml does, from `cwd`. */
function runScript(script: string, args: string[], cwd: string) {
  const r = spawnSync('node', ['--experimental-strip-types', join(HERE, script), ...args], {
    cwd,
    encoding: 'utf8',
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}

/** A git repo with one commit per subject; returns it and its first commit. */
function createRepo(subjects: string[]): { repo: string; first: string } {
  const repo = mkdtempSync(join(tmpdir(), 'changelog-cli-'));
  temps.push(repo);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'changelog-test');
  git('config', 'user.email', 'changelog-test@chord.invalid');
  subjects.forEach((subject, i) => {
    writeFileSync(join(repo, `f${i}.txt`), subject);
    git('add', '.');
    git('commit', '-q', '-m', subject);
  });
  return { repo, first: git('rev-list', '--max-parents=0', 'HEAD') };
}

describe('changelog.ts', () => {
  it('writes the section for <from>..HEAD into CHANGELOG.md, dated today by default', () => {
    const { repo, first } = createRepo([
      'chore: seed (devstation-ab12)',
      'fix(main): a fix (devstation-cd34)',
    ]);

    const r = runScript('changelog.ts', ['--from', first, '--version', 'v1.0.0'], repo);

    expect(r.code).toBe(0);
    const today = new Date().toISOString().slice(0, 10);
    expect(readFileSync(join(repo, 'CHANGELOG.md'), 'utf8')).toBe(
      `# Changelog\n\n## v1.0.0 (${today})\n\n### Fixes\n\n- **main:** a fix (devstation-cd34)\n`
    );
  });

  it('refuses a range with a subject that breaks the commit rule, and writes nothing', () => {
    const { repo, first } = createRepo(['chore: seed (devstation-ab12)', 'wip']);

    const r = runScript('changelog.ts', ['--from', first, '--version', 'v1.0.0'], repo);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('break the commit rule');
    expect(() => readFileSync(join(repo, 'CHANGELOG.md'))).toThrow();
  });

  it("extracts a version's section to --out release-notes/<tag>.md, making the directory", () => {
    const { repo, first } = createRepo([
      'chore: seed (devstation-ab12)',
      'feat(renderer): a feature (devstation-cd34)',
    ]);
    runScript(
      'changelog.ts',
      ['--from', first, '--version', 'v1.0.0', '--date', '2026-10-19'],
      repo
    );

    const r = runScript(
      'changelog.ts',
      ['--extract', 'v1.0.0', '--out', 'release-notes/v1.0.0.md'],
      repo
    );

    expect(r.code).toBe(0);
    expect(readFileSync(join(repo, 'release-notes', 'v1.0.0.md'), 'utf8')).toBe(
      '### Features\n\n- **renderer:** a feature (devstation-cd34)\n'
    );
  });

  it('fails with its usage when arguments are missing', () => {
    const { repo } = createRepo(['chore: seed (devstation-ab12)']);
    for (const args of [[], ['--version', 'v1.0.0'], ['--extract', 'v1.0.0']]) {
      const r = runScript('changelog.ts', args, repo);
      expect(r.code).not.toBe(0);
      expect(r.err).toContain('Usage:');
    }
  });
});

describe('build.ts', () => {
  it('publishes, so it refuses to run without --release-notes', () => {
    const { repo } = createRepo(['chore: seed (devstation-ab12)']);

    const r = runScript('build.ts', ['--platform', 'win'], repo);

    expect(r.code).not.toBe(0);
    expect(r.err).toContain('--release-notes');
  });

  it('refuses a --release-notes file that does not exist before any build step runs', () => {
    const { repo } = createRepo(['chore: seed (devstation-ab12)']);

    const r = runScript(
      'build.ts',
      ['--platform', 'win', '--arch', 'x64', '--release-notes', 'release-notes/v1.0.0.md'],
      repo
    );

    expect(r.code).not.toBe(0);
    expect(r.err).toContain(
      `release notes file not found: ${join(repo, 'release-notes', 'v1.0.0.md')}`
    );
    expect(r.out).not.toContain('Building');
  });
});
