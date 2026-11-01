import { describe, expect, it } from 'vitest';
import { navigationForPublicLink } from './public-link-navigation';

const SERVER = 'https://sync.example.com';

/**
 * A public link opened in the app (step 4, decision 10): the signed-in caller
 * who can reach the artifact gets it as a tab through the artifact link;
 * otherwise the link opens in the browser, which shows it to anyone.
 */
describe('navigationForPublicLink', () => {
  it('opens the artifact the link resolves to', () => {
    expect(
      navigationForPublicLink({ kind: 'resolved', artifactId: 'art-1' }, SERVER, 'tok_abc')
    ).toEqual({ view: 'artifact-link', params: { artifactId: 'art-1' } });
  });

  it('opens the link in the browser when the caller cannot reach the artifact', () => {
    expect(navigationForPublicLink({ kind: 'not_found' }, SERVER, 'tok_abc')).toEqual({
      view: 'external',
      url: 'https://sync.example.com/p/tok_abc',
    });
  });

  it('opens the link in the browser when signed out', () => {
    expect(navigationForPublicLink({ kind: 'signed_out' }, `${SERVER}/`, 'tok_abc')).toEqual({
      view: 'external',
      url: 'https://sync.example.com/p/tok_abc',
    });
  });
});
