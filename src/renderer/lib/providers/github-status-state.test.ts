import { describe, expect, it } from 'vitest';
import { resolveStatusFreshness } from './github-status-state';

describe('resolveStatusFreshness', () => {
  it('is known once a check has answered', () => {
    expect(resolveStatusFreshness(true, null)).toBe('known');
  });

  it('is known before the first check has failed', () => {
    expect(resolveStatusFreshness(false, null)).toBe('known');
  });

  it('keeps a previously answered state as stale when a refresh fails', () => {
    expect(resolveStatusFreshness(true, 'ENOTFOUND api.github.com')).toBe('stale');
  });

  it('is unknown when the check failed and nothing was ever learned', () => {
    expect(resolveStatusFreshness(false, 'ENOTFOUND api.github.com')).toBe('unknown');
  });

  it('never reports unknown while a last known state exists', () => {
    const errors = ['offline', 'timeout', '502 Bad Gateway'];
    for (const error of errors) {
      expect(resolveStatusFreshness(true, error)).not.toBe('unknown');
    }
  });
});
