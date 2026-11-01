import { describe, expect, it } from 'vitest';
import { cloudBandState } from './cloud-band-state';

const snapshot = (files: number, branch_name: string | null) => ({
  files: Array.from({ length: files }, (_, i) => ({ path: `f${i}` })),
  branch_name,
});

const ON_REPO = { repo_name: 'Kami', repo_remote_url: 'github.com/acme/kami' };
const NO_REPO = { repo_name: null, repo_remote_url: null };

/**
 * A teammate's band states what the owner's pushed snapshot says (step 4, S7):
 * the same row as the owner's, from the cloud.
 */
describe('cloudBandState', () => {
  it('counts the changed files the owner pushed', () => {
    expect(cloudBandState(snapshot(3, 'feat/kami'), ON_REPO)).toEqual({
      glyph: 'changes',
      signal: 'neutral',
      text: '3 changed files',
      short: '3',
    });
    expect(cloudBandState(snapshot(1, 'feat/kami'), ON_REPO).text).toBe('1 changed file');
  });

  it('names the branch of a clean snapshot', () => {
    expect(cloudBandState(snapshot(0, 'feat/kami'), ON_REPO)).toMatchObject({
      glyph: 'branch',
      text: 'feat/kami',
    });
  });

  it('says nothing has arrived when the owner never synced', () => {
    expect(cloudBandState(null, ON_REPO)).toMatchObject({
      glyph: 'branch',
      text: 'No changes shared yet',
    });
    expect(cloudBandState(snapshot(0, null), ON_REPO).text).toBe('No changes shared yet');
  });

  // devstation-c4t: an item with no repository has no git state to sync, ever;
  // "Not synced" told the teammate something was missing that never existed.
  it('says an item without a repository has none, rather than that it is unsynced', () => {
    expect(cloudBandState(null, NO_REPO)).toEqual({
      glyph: 'branch',
      signal: 'neutral',
      text: 'No repository',
      short: 'No repo',
    });
  });

  it('counts an item by its repo name alone, before the owner sent its origin', () => {
    expect(cloudBandState(null, { repo_name: 'Kami', repo_remote_url: null }).text).toBe(
      'No changes shared yet'
    );
  });
});
