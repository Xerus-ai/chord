import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  changelog,
  createReleasedRepo,
  createRepo,
  minDesktop,
  NO_HEALTH,
  pkg,
  RELEASE,
  releaseFiles,
  removeTempRepos,
  temps,
} from './_testing/release-repo.ts';
import { formatReleaseOutputs, readReleaseDecision } from './release-preflight.ts';

/**
 * The release decision release.yml's preflight makes for a CI-green commit of main
 * (devstation-pqub, C4): release, rerun or nothing, and the checks a release must pass before
 * its tag is created. Every case is a real repository with real tags and merge commits.
 */
afterEach(removeTempRepos);

describe('readReleaseDecision: release, rerun or not a release', () => {
  it('an untagged version with its release commit merged is a release, with tag, previous and channel', async () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).resolves.toEqual({
      release: true,
      rerun: false,
      tag: 'v1.1.0',
      previous: 'v1.0.0',
      channel: 'stable',
      server: false,
      minDesktopRaised: false,
      deployed: 'v1.0.0',
    });
  });

  it('a tag already at head_sha is a rerun of that release and continues', async () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);
    r.tag('v1.1.0', head);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).resolves.toMatchObject({
      release: true,
      rerun: true,
      tag: 'v1.1.0',
      previous: 'v1.0.0',
    });
  });

  it('a tag at an earlier commit is not a release', async () => {
    const r = createReleasedRepo();
    const released = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);
    r.tag('v1.1.0', released);
    const head = r.mergePr('fix/b', [['fix(main): b (t-3)', { 'src/main/b.ts': 'export {};\n' }]]);

    await expect(readReleaseDecision(r.repo, head, NO_HEALTH)).resolves.toMatchObject({
      release: false,
    });
  });

  it('a later commit cuts a release whose own merge was never decided', async () => {
    // The release merge's push event was lost (no CI, no release.yml); the next main commit
    // still names the untagged version and must cut it, or the release is stranded for good.
    const r = createReleasedRepo();
    r.mergePr('release/v1.1.0', [[RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])]]);
    const head = r.mergePr('fix/d', [['fix(main): d (t-5)', { 'src/main/d.ts': 'export {};\n' }]]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).resolves.toMatchObject({
      release: true,
      rerun: false,
      tag: 'v1.1.0',
      previous: 'v1.0.0',
    });
  });

  it('a version that never moved and was never tagged (main before its first release) is not a release', async () => {
    const r = createRepo({ ...releaseFiles('0.1.0', []) });
    const head = r.mergePr('feat/a', [
      ['feat(main): a (t-2)', { 'src/main/a.ts': 'export {};\n' }],
    ]);

    const decision = await readReleaseDecision(r.repo, head, NO_HEALTH);

    expect(decision.release).toBe(false);
    expect(decision).toMatchObject({ reason: expect.stringContaining('v0.1.0') });
  });

  it('the first release has no previous tag, and its range (the whole history) deploys the server', async () => {
    const r = createRepo({ ...releaseFiles('0.1.0', []) });
    const head = r.mergePr('release/v1.0.0-canary.1', [
      [RELEASE('v1.0.0-canary.1'), releaseFiles('1.0.0-canary.1')],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => null)).resolves.toMatchObject({
      release: true,
      tag: 'v1.0.0-canary.1',
      previous: null,
      server: true,
    });
  });
});

describe('readReleaseDecision: the release commit', () => {
  it('refuses a version bump with no chore(release) commit, naming the commit it needs', async () => {
    const r = createReleasedRepo();
    const head = r.mergePr('feat/c', [
      [
        'feat(main): c (t-4)',
        { ...releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0']), 'src/main/c.ts': 'export {};\n' },
      ],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).rejects.toThrow(
      /no commit 'chore\(release\): v1\.1\.0 \(<bead>\)'/
    );
  });

  it('refuses a release commit that touches more than the version files, naming the file', async () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [
        RELEASE('v1.1.0'),
        { ...releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0']), 'src/main/sneaky.ts': 'export {};\n' },
      ],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).rejects.toThrow(
      /src\/main\/sneaky\.ts/
    );
  });

  it('refuses two release commits for one tag', async () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
      [RELEASE('v1.1.0'), { 'CHANGELOG.md': changelog('v1.1.0', 'v1.0.0') + '\n' }],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).rejects.toThrow(
      /2 commits/
    );
  });
});

describe('readReleaseDecision: the version files', () => {
  it('refuses package.json and server/package.json disagreeing', async () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [
        RELEASE('v1.1.0'),
        { ...releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0']), 'server/package.json': pkg('1.0.1') },
      ],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).rejects.toThrow(
      /server\/package\.json.*1\.0\.1/
    );
  });

  it('refuses an off-grammar version (1.0.0-rc1)', async () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0-rc1', [
      [RELEASE('v1.1.0-rc1'), releaseFiles('1.1.0-rc1', ['v1.0.0'])],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).rejects.toThrow(
      /not a release tag/
    );
  });

  it('refuses a CHANGELOG without the section for the tag', async () => {
    const r = createReleasedRepo();
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.0.0'])],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).rejects.toThrow(
      /CHANGELOG\.md has no section for v1\.1\.0/
    );
  });
});

describe('readReleaseDecision: what the range carries', () => {
  it('a range with only a server/ migration deploys the server', async () => {
    const r = createRepo({});
    r.tag('v1.0.0');
    r.mergePr('feat/m', [
      ['feat(server): m (t-5)', { 'server/src/db/migrations/0011_m.sql': 'select 1;\n' }],
    ]);
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).resolves.toMatchObject({
      server: true,
    });
  });

  it('a packages/protocol change deploys the server', async () => {
    const r = createRepo({});
    r.tag('v1.0.0');
    r.mergePr('feat/p', [
      ['feat(protocol): p (t-6)', { 'packages/protocol/src/p.ts': 'export {};\n' }],
    ]);
    const head = r.mergePr('release/v1.0.1', [
      [RELEASE('v1.0.1'), releaseFiles('1.0.1', ['v1.0.1', 'v1.0.0'])],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).resolves.toMatchObject({
      server: true,
      minDesktopRaised: false,
    });
  });

  it('a canary version selects the canary channel, and previous is the last tag of any channel', async () => {
    const r = createReleasedRepo();
    r.tag('v1.1.0-canary.1');
    r.mergePr('fix/x', [['fix(renderer): x (t-7)', { 'src/renderer/x.tsx': 'export {};\n' }]]);
    const head = r.mergePr('release/v1.1.0-canary.2', [
      [RELEASE('v1.1.0-canary.2'), releaseFiles('1.1.0-canary.2', ['v1.1.0-canary.2', 'v1.0.0'])],
    ]);

    await expect(
      readReleaseDecision(r.repo, head, async () => 'v1.1.0-canary.1')
    ).resolves.toMatchObject({
      tag: 'v1.1.0-canary.2',
      previous: 'v1.1.0-canary.1',
      channel: 'canary',
      server: false,
    });
  });

  it('a range that raises MIN_DESKTOP_VERSION says so, so the server deploys after the probe', async () => {
    const r = createReleasedRepo();
    r.mergePr('feat/min', [
      ['feat(protocol): min (t-8)', { 'packages/protocol/src/version.ts': minDesktop('1.1.0') }],
    ]);
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).resolves.toMatchObject({
      server: true,
      minDesktopRaised: true,
    });
  });

  it('refuses a release that raises MIN_DESKTOP_VERSION above its own version', async () => {
    const r = createReleasedRepo();
    r.mergePr('feat/min', [
      ['feat(protocol): min (t-8)', { 'packages/protocol/src/version.ts': minDesktop('1.2.0') }],
    ]);
    const head = r.mergePr('release/v1.1.0', [
      [RELEASE('v1.1.0'), releaseFiles('1.1.0', ['v1.1.0', 'v1.0.0'])],
    ]);

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).rejects.toThrow(
      /MIN_DESKTOP_VERSION 1\.2\.0/
    );
  });
});

describe('readReleaseDecision: a git that cannot answer', () => {
  // A checkout without history has no tags and no parents: read as missing, a merge on top of
  // v1.0.0 would look like the first release of v1.0.0.
  it('refuses a shallow clone, naming the full history it needs', async () => {
    const r = createReleasedRepo();
    const shallow = mkdtempSync(join(tmpdir(), 'release-preflight-shallow-'));
    temps.push(shallow);
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${r.repo}`, shallow]);
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: shallow, encoding: 'utf8' });

    await expect(readReleaseDecision(shallow, head.trim(), async () => null)).rejects.toThrow(
      /shallow clone.*fetch-depth: 0/
    );
  });

  it('a git failure is an error, not a missing tag or parent', async () => {
    const r = createReleasedRepo();
    const head = r.git('rev-parse', 'HEAD');
    // The tag's object is gone: git exits 128, which is not "no such tag".
    const tagObject = r.git('rev-parse', 'refs/tags/v1.0.0');
    rmSync(join(r.repo, '.git', 'objects', tagObject.slice(0, 2), tagObject.slice(2)));

    await expect(readReleaseDecision(r.repo, head, async () => 'v1.0.0')).rejects.toThrow(
      /git rev-parse .*v1\.0\.0/
    );
  });
});

describe('formatReleaseOutputs', () => {
  it('writes every output a later job reads, and only release=false when it is not a release', async () => {
    expect(
      formatReleaseOutputs({
        release: true,
        rerun: false,
        tag: 'v1.1.0-canary.2',
        previous: null,
        channel: 'canary',
        server: true,
        minDesktopRaised: false,
        deployed: null,
      })
    ).toBe(
      'release=true\nrerun=false\ntag=v1.1.0-canary.2\nprevious=\nchannel=canary\nserver=true\nmin_desktop_raised=false\ndeployed=\n'
    );
    expect(formatReleaseOutputs({ release: false, reason: 'v1.0.0 is tagged at abc' })).toBe(
      'release=false\n'
    );
  });
});
