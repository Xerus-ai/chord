import { describe, expect, it } from 'vitest';
import {
  recordSettingsOrigin,
  resolveSettingsReturn,
  type SettingsOrigin,
} from '@renderer/lib/stores/settings-return';

/**
 * Back to app returns to the exact view the user left, with its params. The
 * origin is recorded when settings is entered from another view and is not
 * overwritten by in-settings navigation (tab changes are param updates on the
 * settings view, not navigations, but a deep link may call navigate again).
 */
describe('settings return origin', () => {
  it('records the view and params that opened settings', () => {
    const origin = recordSettingsOrigin(null, 'work-list', { workItemId: 'wi-1' });
    expect(origin).toEqual({ viewId: 'work-list', params: { workItemId: 'wi-1' } });
  });

  it('keeps the first origin when settings navigates to settings again', () => {
    const first: SettingsOrigin = { viewId: 'dashboard', params: {} };
    expect(recordSettingsOrigin(first, 'settings', { tab: 'git' })).toBe(first);
  });

  it('returns to the dashboard when settings was the first view of the session', () => {
    expect(resolveSettingsReturn(null)).toEqual({ viewId: 'dashboard', params: {} });
  });

  it('returns to the recorded origin otherwise', () => {
    const origin: SettingsOrigin = { viewId: 'work-list', params: { workItemId: 'wi-2' } };
    expect(resolveSettingsReturn(origin)).toEqual(origin);
  });
});
