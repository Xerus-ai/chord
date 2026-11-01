import { describe, expect, it } from 'vitest';
import { isTokenRejected } from './token-rejection';

describe('isTokenRejected', () => {
  it('treats 401 as the token being no good', () => {
    expect(isTokenRejected(Object.assign(new Error('Bad credentials'), { status: 401 }))).toBe(
      true
    );
  });

  it('treats 403 as the token being no good', () => {
    expect(isTokenRejected(Object.assign(new Error('Forbidden'), { status: 403 }))).toBe(true);
  });

  it('does not read a server error as a disconnect', () => {
    expect(isTokenRejected(Object.assign(new Error('Bad gateway'), { status: 502 }))).toBe(false);
  });

  it('does not read a network failure as a disconnect', () => {
    expect(isTokenRejected(new Error('getaddrinfo ENOTFOUND api.github.com'))).toBe(false);
  });

  it('handles non-error rejection values', () => {
    expect(isTokenRejected(null)).toBe(false);
    expect(isTokenRejected(undefined)).toBe(false);
    expect(isTokenRejected('401')).toBe(false);
  });
});
