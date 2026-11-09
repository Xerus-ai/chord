import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestClipboard } from '@main/core/app/_testing/test-clipboard';

/**
 * CHORD_FORCE_FRESH_LOGIN puts the WorkOS authorization URL on the clipboard
 * instead of opening the browser. Since Electron 44 the write is a Promise:
 * the copy resolves only once the URL is on the clipboard, and a refused write
 * rejects the copy instead of logging a copy that never happened.
 */
vi.mock('electron', async () => {
  const { testClipboard } = await import('@main/core/app/_testing/test-clipboard');
  return { clipboard: testClipboard() };
});

const electron = await import('electron');
const clipboard = electron.clipboard as unknown as TestClipboard;
const { copyFreshLoginUrl } = await import('./fresh-login-url');

const AUTHORIZATION_URL = 'https://auth.example.test/authorize?client_id=chord&state=s1';

beforeEach(() => {
  clipboard.reset();
});

describe('copyFreshLoginUrl', () => {
  it('the login URL is on the clipboard when copyFreshLoginUrl resolves', async () => {
    await copyFreshLoginUrl(AUTHORIZATION_URL);
    expect(clipboard.text()).toBe(`${AUTHORIZATION_URL}&max_age=0`);
  });

  it('a refused clipboard write rejects the copy', async () => {
    clipboard.refuse('clipboard unavailable');
    await expect(copyFreshLoginUrl(AUTHORIZATION_URL)).rejects.toThrow('clipboard unavailable');
    expect(clipboard.text()).toBe('');
  });
});
