import { afterAll, describe, expect, it } from 'vitest';
import {
  collectDeclaringFileRecord,
  collectDeclaringOrderRecord,
  collectFileProbeRecord,
  createRepoFactory,
} from './_testing/repo-icon-detection-cases';
import expected from './_testing/repo-icon-detection.expected.json';
import { collectRemoteRecord } from './_testing/repo-icon-remote-cases';

/**
 * Characterization (devstation-7orh): repo-icon detection was rewritten from a
 * behaviour spec, and the user's acceptance is that it returns the same icon
 * for the same repositories. The expected record was taken from the
 * implementation before the rewrite, over real temp repositories, real git
 * remotes and a real loopback avatar server.
 */
const { createRepo, removeRepos } = createRepoFactory();
afterAll(removeRepos);

describe('repo icon detection, characterized', () => {
  it(
    'reads icon files, formats, precedence and size limits the same way',
    { timeout: 120_000 },
    async () => {
      expect(await collectFileProbeRecord(createRepo)).toEqual(expected.fileProbe);
    }
  );

  it('reads the same declaring files', { timeout: 120_000 }, async () => {
    expect(await collectDeclaringFileRecord(createRepo)).toEqual(expected.declaringFiles);
  });

  it('prefers declaring files in the same order', { timeout: 120_000 }, async () => {
    expect(await collectDeclaringOrderRecord(createRepo)).toEqual(expected.declaringOrder);
  });

  it('asks the same avatar host for the same remotes', { timeout: 120_000 }, async () => {
    expect(await collectRemoteRecord(createRepo)).toEqual(expected.remotes);
  });
});
