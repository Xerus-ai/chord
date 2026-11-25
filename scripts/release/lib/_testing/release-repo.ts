import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

/**
 * Real repositories for the release decision's tests (release-preflight.test.ts,
 * release-preflight-deployed.test.ts): version files, release commits, tags and merge commits
 * the way GitHub makes them.
 */
export const temps: string[] = [];
/** Each test file's afterEach: removes the repositories its cases made. */
export function removeTempRepos(): void {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export type Files = Record<string, string>;

export const pkg = (version: string) => `${JSON.stringify({ name: 'chord', version }, null, 2)}\n`;
export const minDesktop = (min: string) => `export const MIN_DESKTOP_VERSION = '${min}';\n`;
export const changelog = (...versions: string[]) =>
  `# Changelog\n\n${versions.map((v) => `## ${v} (2026-11-18)\n\n### Fixes\n\n- a fix (t-1)\n`).join('\n')}`;

/** The version files of a release: both package.json files and the CHANGELOG section. */
export const releaseFiles = (version: string, sections: string[] = [`v${version}`]): Files => ({
  'package.json': pkg(version),
  'server/package.json': pkg(version),
  'CHANGELOG.md': changelog(...sections),
});

export function createRepo(initial: Files) {
  const repo = mkdtempSync(join(tmpdir(), 'release-preflight-'));
  temps.push(repo);
  const git = (...args: string[]) =>
    execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Preflight Test');
  git('config', 'user.email', 'test@example.com');
  const commit = (subject: string, files: Files) => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
    git('add', '-A');
    git('commit', '-q', '-m', subject);
    return git('rev-parse', 'HEAD');
  };
  /** A PR: `branch` off main with these commits, merged with a merge commit as GitHub does. */
  const mergePr = (branch: string, commits: [string, Files][]) => {
    git('checkout', '-q', '-b', branch);
    for (const [subject, files] of commits) commit(subject, files);
    git('checkout', '-q', 'main');
    git('merge', '-q', '--no-ff', '-m', `Merge pull request from ${branch}`, branch);
    return git('rev-parse', 'HEAD');
  };
  const tag = (name: string, ref = 'HEAD') => git('tag', '-a', name, '-m', name, ref);
  commit('chore: start (t-0)', {
    ...releaseFiles('1.0.0'),
    'packages/protocol/src/version.ts': minDesktop('0.1.0'),
    'src/renderer/app.tsx': 'export {};\n',
    'server/src/index.ts': 'export {};\n',
    ...initial,
  });
  return { repo, git, commit, mergePr, tag };
}

/** A repo released at v1.0.0, then a renderer feature merged. */
export function createReleasedRepo() {
  const r = createRepo({});
  r.tag('v1.0.0');
  r.mergePr('feat/a', [
    ['feat(renderer): a (t-2)', { 'src/renderer/app.tsx': 'export const a = 1;\n' }],
  ]);
  return r;
}

export const RELEASE = (tag: string) => `chore(release): ${tag} (t-9)`;
/**
 * Only an untagged version its parent already names, with its release commit in range, asks
 * whether CI ran on the commit that moved the version; every other decision never asks.
 */
export const NO_CI_ASKED = async (sha: string): Promise<boolean> => {
  throw new Error(`asked whether CI ran on ${sha}`);
};
/** A commit that is not a release never asks the server what it runs (its /health may be down). */
export const NO_HEALTH = async (): Promise<string | null> => {
  throw new Error('read /health for a commit that is not a release');
};
