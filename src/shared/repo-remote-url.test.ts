import { describe, expect, it } from 'vitest';
import { normalizeRemoteUrl } from './repo-remote-url';

/**
 * A work item's repo is matched across machines by its origin (shared-items
 * step 3, decision 5). The owner's clone and the teammate's may name the same
 * repo over ssh or https, with or without `.git`, in any case; stored in one
 * normalized form, matching is plain equality.
 */
describe('normalizeRemoteUrl', () => {
  const CHORD = 'github.com/acme/chord';

  it.each([
    ['scp-style ssh', 'git@github.com:acme/chord.git'],
    ['scp-style ssh without .git', 'git@github.com:acme/chord'],
    ['scp-style without a user', 'github.com:acme/chord.git'],
    ['ssh url', 'ssh://git@github.com/acme/chord.git'],
    ['ssh url with a port', 'ssh://git@github.com:22/acme/chord.git'],
    ['https', 'https://github.com/acme/chord'],
    ['https with .git and a trailing slash', 'https://github.com/acme/chord.git/'],
    ['http', 'http://github.com/acme/chord.git'],
    ['git protocol', 'git://github.com/acme/chord.git'],
    ['mixed case and whitespace', '  https://GitHub.com/Acme/Chord.GIT  '],
  ])('reads %s as the same repo', (_label, raw) => {
    expect(normalizeRemoteUrl(raw)).toBe(CHORD);
  });

  it('never keeps credentials embedded in an https remote', () => {
    expect(normalizeRemoteUrl('https://x-access-token:ghp_secret@github.com/acme/chord.git')).toBe(
      CHORD
    );
  });

  it('keeps every path segment of a nested group', () => {
    expect(normalizeRemoteUrl('git@gitlab.com:acme/platform/chord.git')).toBe(
      'gitlab.com/acme/platform/chord'
    );
    expect(normalizeRemoteUrl('https://gitlab.com/acme/platform/chord')).toBe(
      'gitlab.com/acme/platform/chord'
    );
  });

  it('tells different repos apart', () => {
    expect(normalizeRemoteUrl('git@github.com:acme/chord.git')).not.toBe(
      normalizeRemoteUrl('git@github.com:acme/chord-web.git')
    );
    expect(normalizeRemoteUrl('git@github.com:acme/chord.git')).not.toBe(
      normalizeRemoteUrl('git@gitlab.com:acme/chord.git')
    );
  });

  it.each([
    ['empty', ''],
    ['blank', '   '],
    ['a posix path', '/home/me/chord'],
    ['a relative path', '../chord'],
    ['a windows path', 'C:\\repos\\chord'],
    ['a windows path with forward slashes', 'C:/repos/chord'],
    ['a file url', 'file:///home/me/chord.git'],
    ['a host with no repo', 'https://github.com/'],
  ])('has no remote identity for %s', (_label, raw) => {
    expect(normalizeRemoteUrl(raw)).toBeNull();
  });
});
