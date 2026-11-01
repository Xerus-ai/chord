import { describe, expect, it } from 'vitest';
import { orderDeepLinkNavigations } from './claimed-deep-links';

/**
 * The renderer subscribes to live links first, then claims the links main
 * queued before it was ready. A live link that arrives while the claim is in
 * flight is newer than every queued one, so it must be navigated last — the
 * most recent link the user clicked is the view they end on.
 */
describe('orderDeepLinkNavigations', () => {
  it('navigates queued links in the order main received them', () => {
    expect(
      orderDeepLinkNavigations({
        claimed: [
          { kind: 'work-item', workItemId: 'wi1' },
          { kind: 'artifact', artifactId: 'art1' },
        ],
        liveDuringClaim: [],
      })
    ).toEqual([
      { view: 'work-list', params: { workItemId: 'wi1' } },
      { view: 'artifact-link', params: { artifactId: 'art1' } },
    ]);
  });

  it('a live link received during the claim goes after every queued link', () => {
    expect(
      orderDeepLinkNavigations({
        claimed: [{ kind: 'work-item', workItemId: 'wi1' }],
        liveDuringClaim: [{ kind: 'public-link', token: 'tok_abc' }],
      })
    ).toEqual([
      { view: 'work-list', params: { workItemId: 'wi1' } },
      { view: 'public-link', params: { token: 'tok_abc' } },
    ]);
  });

  it('nothing queued and nothing live navigates nowhere', () => {
    expect(orderDeepLinkNavigations({ claimed: [], liveDuringClaim: [] })).toEqual([]);
  });
});
