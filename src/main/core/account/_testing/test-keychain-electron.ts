import { electronWithTestKeychain } from './test-keychain';

/**
 * The `electron` module for a main-process suite, its only export the test
 * keychain's `safeStorage` (`test-keychain.ts`):
 *
 *   vi.mock('electron', () => import('@main/core/account/_testing/test-keychain-electron'));
 *
 * Imports nothing that reaches `electron`, as `test-keychain.ts` explains.
 */
export const { safeStorage } = electronWithTestKeychain();
