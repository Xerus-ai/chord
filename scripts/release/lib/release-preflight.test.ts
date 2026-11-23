import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { formatReleaseOutputs, readReleaseDecision } from './release-preflight.ts';

/**
 * The release decision release.yml's preflight makes for a CI-green commit of main
 * (devstation-pqub, C4): release, rerun or nothing, and the checks a release must pass before
 * its tag is created. Every case is a real repository with real tags and merge commits.
 */
const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

type Files = Record<string, string>;

const pkg = (version: string) => `${JSON.stringify({ name: 'chord', version }, null, 2)}\n`;
const minDesktop = (min: string) => `export const MIN_DESKTOP_VERSION = '${min}';\n`;
const changelog = (...versions: string[]) =>
  `# Changelog\n\n${versions.map((v) => `## ${v} (2026-11-18)\n\n### Fixes\n\n- a fix (t-1)\n`).join('\n')}`;

/** The version files of a release: both package.json files and the CHANGELOG section. */
const releaseFiles = (version: string, sections: string[] = [`v${version}`]): Files => ({
  'package.json': pkg(version),
  'server/package.json': pkg(version),
  'CHANGELOG.md': changelog(...sections),
});

function createRepo(initial: Files) {
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
function createReleasedRepo() {
  const r = createRepo({});
  r.tag('v1.0.0');
  r.mergePr('feat/a', [
    ['feat(renderer): a (t-2)', { 'src/renderer/app.tsx': 'export const a = 1;\n' }],
  ]);
  return r;
}

const RELEASE = (tag: string) => `chore(release): ${tag} (t-9)`;

describe('readReleaseDecision: release, rerun or not a release', () => {
  it('an untagged version with its release commit merged is a release, with tag, previous and channel', () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);

    expect(readReleaseDecision(r.repo, head, 'v1.0.0')).toEqual({
      release: true,
      rerun: false,
      tag: 'v1.1.0',
      previous: 'v1.0.0',
      channel: 'stable',
      server: false,
      minDesktopRaised: false,
    });
  });

  it('a tag already at head_sha is a rerun of that release and continues', () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);
    r.tag('v1.1.0', head);

    expect(readReleaseDecision(r.repo, head, 'v1.0.0')).toMatchObject({
      release: true,
      rerun: true,
      tag: 'v1.1.0',
      previous: 'v1.0.0',
    });
  });

  it('a tag at an earlier commit is not a release', () => {
    const r = createReleasedRepo();
    const released = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);
    r.tag('v1.1.0', released);
    const head = r.mergePr('fix/b', [['fix(main): b (t-3)', { 'src/main/b.ts': 'export {};\n' }]]);

    expect(readReleaseDecision(r.repo, head, 'v1.1.0')).toMatchObject({ release: false });
  });

  it('a version that never moved and was never tagged (main before its first release) is not a release', () => {
    const r = createRepo({ ...releaseFiles('0.1.0', []) });
    const head = r.mergePr('feat/a', [
      ['feat(main): a (t-2)', { 'src/main/a.ts': 'export {};\n' }],
    ]);

    const decision = readReleaseDecision(r.repo, head, null);

    expect(decision.release).toBe(false);
    expect(decision).toMatchObject({ reason: expect.stringContaining('v0.1.0') });
  });

  it('the first release has no previous tag, and its range (the whole history) deploys the server', () => {
    const r = createRepo({ ...releaseFiles('0.1.0', []) });
    const head = r.mergePr('release/v1.0.0-canary.1', [
      [RELEASE('v1.0.0-canary.1'), releaseFiles('1.0.0-canary.1')],
    ]);

    expect(readReleaseDecision(r.repo, head, null)).toMatchObject({
      release: true,
      tag: 'v1.0.0-canary.1',
      previous: null,
      server: true,
    });
  });
});

describe('readReleaseDecision: the release commit', () => {
  it('refuses a version bump with no chore(release) commit, naming the commit it needs', () => {
    const r = createReleasedRepo();
    const head = r.mergePr('feat/c', [
      [
        'feat(main): c (t-4)',
        { ...releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0']), 'src/main/c.ts': 'export {};\n' },
      ],
    ]);

    expect(() => readReleaseDecision(r.repo, head, 'v1.0.0')).toThrow(
      /no commit 'chore\(release\): v1\.1\.0 \(<bead>\)'/
    );
  });

  it('refuses a release commit that touches more than the version files, naming the file', () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [
        RELEASE('v1.1.0'),
        { ...releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0']), 'src/main/sneaky.ts': 'export {};\n' },
      ],
    ]);

    expect(() => readReleaseDecision(r.repo, head, 'v1.0.0')).toThrow(/src\/main\/sneaky\.ts/);
  });

  it('refuses two release commits for one tag', () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
      [RELEASE('v1.1.0'), { 'CHANGELOG.md': changelog('v1.1.0', 'v1.0.0') + '\n' }],
    ]);

    expect(() => readReleaseDecision(r.repo, head, 'v1.0.0')).toThrow(/2 commits/);
  });
});

describe('readReleaseDecision: the version files', () => {
  it('refuses package.json and server/package.json disagreeing', () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [
        RELEASE('v1.1.0'),
        { ...releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0']), 'server/package.json': pkg('1.0.1') },
      ],
    ]);

    expect(() => readReleaseDecision(r.repo, head, 'v1.0.0')).toThrow(
      /server\/package\.json.*1\.0\.1/
    );
  });

  it('refuses an off-grammar version (1.0.0-rc1)', () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0-rc1', [
      [RELEASE('v1.1.0-rc1'), releaseFiles('1.1.0-rc1', ['v1.0.0'])],
    ]);

    expect(() => readReleaseDecision(r.repo, head, 'v1.0.0')).toThrow(/not a release tag/);
  });

  it('refuses a CHANGELOG without the section for the tag', () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.0.0'])],
    ]);

    expect(() => readReleaseDecision(r.repo, head, 'v1.0.0')).toThrow(
      /CHANGELOG\.md has no section for v1\.1\.0/
    );
  });
});

describe('readReleaseDecision: what the range carries', () => {
  it('a range with only a server/ migration deploys the server', () => {
    const r = createRepo({});
    r.tag('v1.0.0');
    r.mergePr('feat/m', [
      ['feat(server): m (t-5)', { 'server/src/db/migrations/0011_m.sql': 'select 1;\n' }],
    ]);
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);

    expect(readReleaseDecision(r.repo, head, 'v1.0.0')).toMatchObject({ server: true });
  });

  it('a packages/protocol change deploys the server', () => {
    const r = createRepo({});
    r.tag('v1.0.0');
    r.mergePr('feat/p', [
      ['feat(protocol): p (t-6)', { 'packages/protocol/src/p.ts': 'export {};\n' }],
    ]);
    const head = r.mergePr('release/v1.0.1', [
      [RELEASE('v1.0.1'), releaseFiles('1.0.1', ['v1.0.1', 'v1.0.0'])],
    ]);

    expect(readReleaseDecision(r.repo, head, 'v1.0.0')).toMatchObject({
      server: true,
      minDesktopRaised: false,
    });
  });

  it('a canary version selects the canary channel, and previous is the last tag of any channel', () => {
    const r = createReleasedRepo();
    r.tag('v1.1.0-canary.1');
    r.mergePr('fix/x', [['fix(renderer): x (t-7)', { 'src/renderer/x.tsx': 'export {};\n' }]]);
    const head = r.mergePr('release/v1.1.0-canary.2', [
      [RELEASE('v1.1.0-canary.2'), releaseFiles('1.1.0-canary.2', ['v1.1.0-canary.2', 'v1.0.0'])],
    ]);

    expect(readReleaseDecision(r.repo, head, 'v1.1.0-canary.1')).toMatchObject({
      tag: 'v1.1.0-canary.2',
      previous: 'v1.1.0-canary.1',
      channel: 'canary',
      server: false,
    });
  });

  it('a range that raises MIN_DESKTOP_VERSION says so, so the server deploys after the probe', () => {
    const r = createReleasedRepo();
    r.mergePr('feat/min', [
      ['feat(protocol): min (t-8)', { 'packages/protocol/src/version.ts': minDesktop('1.1.0') }],
    ]);
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);

    expect(readReleaseDecision(r.repo, head, 'v1.0.0')).toMatchObject({
      server: true,
      minDesktopRaised: true,
    });
  });

  it('refuses a release that raises MIN_DESKTOP_VERSION above its own version', () => {
    const r = createReleasedRepo();
    r.mergePr('feat/min', [
      ['feat(protocol): min (t-8)', { 'packages/protocol/src/version.ts': minDesktop('1.2.0') }],
    ]);
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);

    expect(() => readReleaseDecision(r.repo, head, 'v1.0.0')).toThrow(
      /MIN_DESKTOP_VERSION 1\.2\.0/
    );
  });
});

describe('readReleaseDecision: a git that cannot answer', () => {
  // A checkout without history has no tags and no parents: read as missing, a merge on top of
  // v1.0.0 would look like the first release of v1.0.0.
  it('refuses a shallow clone, naming the full history it needs', () => {
    const r = createReleasedRepo();
    const shallow = mkdtempSync(join(tmpdir(), 'release-preflight-shallow-'));
    temps.push(shallow);
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${r.repo}`, shallow]);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: shallow, encoding: 'utf8' });

    expect(() => readReleaseDecision(shallow, head.trim(), null)).toThrow(
      /shallow clone.*fetch-depth: 0/
    );
  });

  it('a git failure is an error, not a missing tag or parent', () => {
    const r = createReleasedRepo();
    const head = r.git('rev-parse', 'HEAD');
    // The tag's object is gone: git exits 128, which is not "no such tag".
    const tagObject = r.git('rev-parse', 'refs/tags/v1.0.0');
    rmSync(join(r.repo, '.git', 'objects', tagObject.slice(0, 2), tagObject.slice(2)));

    expect(() => readReleaseDecision(r.repo, head, 'v1.0.0')).toThrow(/git rev-parse .*v1\.0\.0/);
  });
});

describe('readReleaseDecision: the server range starts at the tag the server runs', () => {
  /** v1.1.0 (a server migration) tagged but its deploy failed, then a renderer-only v1.1.1. */
  function failedDeployThenRenderer() {
    const r = createReleasedRepo();
    r.mergePr('feat/m', [['feat(server): m (t-5)', { 'server/src/m.sql': 'select 1;\n' }]]);
    r.tag(
      'v1.1.0',
      r.mergePr('release/v1.1.0', [[RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0'])]])
    );
    r.mergePr('fix/r', [['fix(renderer): r (t-6)', { 'src/renderer/r.tsx': 'export {};\n' }]]);
    const head = r.mergePr('release/v1.1.1', [
      [RELEASE('v1.1.1'), releaseFiles('1.1.1', ['v1.1.1'])],
    ]);
    return { r, head };
  }

  it('a release after a failed server deploy deploys the server it still owes', () => {
    const { r, head } = failedDeployThenRenderer();

    expect(readReleaseDecision(r.repo, head, 'v1.0.0')).toMatchObject({
      previous: 'v1.1.0',
      server: true,
    });
    expect(readReleaseDecision(r.repo, head, 'v1.1.0')).toMatchObject({ server: false });
  });

  it('a server that names no release is deployed', () => {
    const { r, head } = failedDeployThenRenderer();

    expect(readReleaseDecision(r.repo, head, null)).toMatchObject({ server: true });
  });

  it('refuses a server running a tag this release does not contain, naming it', () => {
    const { r, head } = failedDeployThenRenderer();
    r.tag('v9.0.0', r.commit('chore: elsewhere (t-7)', { 'x.txt': 'x\n' }));

    expect(() => readReleaseDecision(r.repo, head, 'v9.0.0')).toThrow(/v9\.0\.0/);
    expect(() => readReleaseDecision(r.repo, head, 'v7.7.7')).toThrow(/v7\.7\.7/);
  });
});

describe('formatReleaseOutputs', () => {
  it('writes every output a later job reads, and only release=false when it is not a release', () => {
    expect(
      formatReleaseOutputs({
        release: true,
        rerun: false,
        tag: 'v1.1.0-canary.2',
        previous: null,
        channel: 'canary',
        server: true,
        minDesktopRaised: false,
      })
    ).toBe(
      'release=true\nrerun=false\ntag=v1.1.0-canary.2\nprevious=\nchannel=canary\nserver=true\nmin_desktop_raised=false\n'
    );
    expect(formatReleaseOutputs({ release: false, reason: 'v1.0.0 is tagged at abc' })).toBe(
      'release=false\n'
    );
  });
});
