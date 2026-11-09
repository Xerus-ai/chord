import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { TestClipboard } from './_testing/test-clipboard';

/**
 * The `clipboardWriteText` RPC through the real controller and service. Since
 * Electron 44 `clipboard.writeText` returns a Promise: the RPC must answer
 * only once the text is on the clipboard, and a refused write must answer
 * `success: false` rather than a success the clipboard never saw. `electron`
 * is the test keychain plus an Electron 44-shaped clipboard; the database is
 * real SQLite from the shipped migrations.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  const { testClipboard } = await import('./_testing/test-clipboard');
  return { ...electronWithTestKeychain(), clipboard: testClipboard() };
});

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const electron = await import('electron');
const clipboard = electron.clipboard as unknown as TestClipboard;
const { appController } = await import('./controller');

beforeEach(() => {
  clipboard.reset();
});

describe('clipboardWriteText under the Electron 44 clipboard', () => {
  it('the text is on the clipboard when clipboardWriteText resolves', async () => {
    const result = await appController.clipboardWriteText('chord://lane/42');
    expect(result).toEqual({ success: true });
    expect(clipboard.text()).toBe('chord://lane/42');
  });

  it('a refused clipboard write answers success false', async () => {
    clipboard.refuse('clipboard is locked by another process');
    const result = await appController.clipboardWriteText('chord://lane/43');
    expect(result).toEqual({ success: false, error: 'clipboard is locked by another process' });
    expect(clipboard.text()).toBe('');
  });
});
