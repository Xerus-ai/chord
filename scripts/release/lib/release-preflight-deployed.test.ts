import { afterEach, describe, expect, it } from 'vitest';
import {
  createReleasedRepo,
  NO_CI_ASKED,
  RELEASE,
  releaseFiles,
  removeTempRepos,
} from './_testing/release-repo.ts';
import { readReleaseDecision } from './release-preflight.ts';

/**
 * The server range and the migration lint's base start at the tag the live server runs, not
 * the newest tag: a release whose deploy failed still owes the server its changes.
 */
afterEach(removeTempRepos);

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

  it('a release after a failed server deploy deploys the server it still owes', async () => {
    const { r, head } = failedDeployThenRenderer();

    // deployed, not previous, is the migration lint's base: v1.1.0 never went live.
    await expect(
      readReleaseDecision(r.repo, head, async () => 'v1.0.0', NO_CI_ASKED)
    ).resolves.toMatchObject({
      previous: 'v1.1.0',
      deployed: 'v1.0.0',
      server: true,
    });
    await expect(
      readReleaseDecision(r.repo, head, async () => 'v1.1.0', NO_CI_ASKED)
    ).resolves.toMatchObject({
      server: false,
    });
  });

  it('a server that names no release is deployed', async () => {
    const { r, head } = failedDeployThenRenderer();

    await expect(
      readReleaseDecision(r.repo, head, async () => null, NO_CI_ASKED)
    ).resolves.toMatchObject({
      server: true,
    });
  });

  it('refuses a server running a tag this release does not contain, naming it', async () => {
    const { r, head } = failedDeployThenRenderer();
    r.tag('v9.0.0', r.commit('chore: elsewhere (t-7)', { 'x.txt': 'x\n' }));

    await expect(
      readReleaseDecision(r.repo, head, async () => 'v9.0.0', NO_CI_ASKED)
    ).rejects.toThrow(/v9\.0\.0/);
    await expect(
      readReleaseDecision(r.repo, head, async () => 'v7.7.7', NO_CI_ASKED)
    ).rejects.toThrow(/v7\.7\.7/);
  });
});
