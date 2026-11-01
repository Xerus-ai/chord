import { describe, expect, it } from 'vitest';
import { rosterBody } from './roster-body';

/**
 * What the People section shows under its header. devstation-nyw: a teammate
 * opening a shared item read "Not shared with anyone" — the roster was still
 * loading, and an unloaded roster was shown as an empty one.
 */
describe('rosterBody', () => {
  it('says the roster is loading while the first fetch is in flight', () => {
    expect(rosterBody({ isPending: true, error: null }, 0)).toBe('loading');
  });

  it('lists the people once they arrive', () => {
    expect(rosterBody({ isPending: false, error: null }, 2)).toBe('rows');
  });

  it('keeps listing the last roster when a refetch fails', () => {
    expect(rosterBody({ isPending: false, error: new Error('offline') }, 2)).toBe('rows');
  });

  it('shows only the failure when there is no roster to fall back on', () => {
    expect(rosterBody({ isPending: false, error: new Error('offline') }, 0)).toBe('error');
  });

  it('says nobody has access only for a loaded, empty roster', () => {
    expect(rosterBody({ isPending: false, error: null }, 0)).toBe('empty');
  });
});
