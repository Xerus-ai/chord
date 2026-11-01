import { describe, expect, it } from 'vitest';
import { navigationForDeepLink } from './deep-link-navigation';

/** `chord://open/…` links forwarded by main, to the view that opens them. */
describe('navigationForDeepLink', () => {
  it('a work item link opens the work list on that item', () => {
    expect(navigationForDeepLink({ kind: 'work-item', workItemId: 'wi1' })).toEqual({
      view: 'work-list',
      params: { workItemId: 'wi1' },
    });
  });

  it('an artifact link opens the artifact-link view, which finds its work item', () => {
    expect(navigationForDeepLink({ kind: 'artifact', artifactId: 'art1' })).toEqual({
      view: 'artifact-link',
      params: { artifactId: 'art1' },
    });
  });

  it('a public link opens the public-link view, which resolves it or opens the browser', () => {
    expect(navigationForDeepLink({ kind: 'public-link', token: 'tok_abc' })).toEqual({
      view: 'public-link',
      params: { token: 'tok_abc' },
    });
  });
});
