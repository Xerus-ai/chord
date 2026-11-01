import { describe, expect, it } from 'vitest';
import { REPO_ICON_KEYS, type RepoIcon } from '@shared/repo-icons';
import { buildRepoIdentityLookup, resolveRepoIdentity } from './repo-identity-lookup';

const LUCIDE_ICON: RepoIcon = { type: 'lucide', key: REPO_ICON_KEYS[0] };
const IMAGE_ICON: RepoIcon = {
  type: 'image',
  src: 'data:image/png;base64,iVBORw0KGgo=',
  source: 'file',
};

/**
 * A sidebar group's key is a local `repos.id` only for the user's own items:
 * a teammate's shared item groups under its cloud `repo_name`, and an item
 * with no repo groups under `'no-repo'`. Neither has a local repo row, so
 * neither may be offered the repo menu — this is where that is decided.
 */
describe('repo identity lookup', () => {
  it('maps a local repo id to its chosen lucide icon', () => {
    const lookup = buildRepoIdentityLookup([{ id: 'r1', icon: LUCIDE_ICON }]);

    expect(resolveRepoIdentity(lookup, 'r1')).toEqual({ icon: LUCIDE_ICON, isLocal: true });
  });

  it('carries a detected image icon through unchanged', () => {
    const lookup = buildRepoIdentityLookup([{ id: 'r1', icon: IMAGE_ICON }]);

    expect(resolveRepoIdentity(lookup, 'r1')).toEqual({ icon: IMAGE_ICON, isLocal: true });
  });

  it('keeps a repo that has settled on the letter tile distinct from one not yet probed', () => {
    const lookup = buildRepoIdentityLookup([
      { id: 'settled', icon: { type: 'letter' } },
      { id: 'unprobed', icon: null },
    ]);

    expect(resolveRepoIdentity(lookup, 'settled')).toEqual({
      icon: { type: 'letter' },
      isLocal: true,
    });
    expect(resolveRepoIdentity(lookup, 'unprobed')).toEqual({ icon: null, isLocal: true });
  });

  it("reports a teammate's repo name and 'no-repo' as not local", () => {
    const lookup = buildRepoIdentityLookup([{ id: 'r1', icon: LUCIDE_ICON }]);

    expect(resolveRepoIdentity(lookup, 'teammate-repo')).toEqual({ icon: null, isLocal: false });
    expect(resolveRepoIdentity(lookup, 'no-repo')).toEqual({ icon: null, isLocal: false });
  });

  it('is empty before the repo list has loaded, so no group claims to be local', () => {
    const lookup = buildRepoIdentityLookup([]);

    expect(resolveRepoIdentity(lookup, 'r1')).toEqual({ icon: null, isLocal: false });
  });
});
