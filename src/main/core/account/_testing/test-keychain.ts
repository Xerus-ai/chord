import type { SafeStorage } from 'electron';

/**
 * The OS keychain for main-process suites that sign in through the real
 * account path (`test-account.ts`). Electron's `safeStorage` does not exist
 * under a plain Node test runner, so a suite replaces the `electron` module
 * with this — `safeStorage` is the only export, the one the credential store
 * (`encrypted-app-secrets-store.ts`) needs. Same precedent as
 * `projects/settings/project-settings.test.ts`, which supplies `app` alone.
 * The account service, the `kv` profile, the credential store and the
 * database all stay real.
 *
 * Only the async API exists here (Electron 45 deprecates the sync one and 46
 * removes it), so a leftover sync call fails every suite that uses this.
 *
 * Imports nothing at run time: the `electron` mock factory loads this module,
 * and any import that reaches `electron` again would wait on the factory
 * forever. The type import is erased.
 */
export type TestSafeStorage = Pick<
  SafeStorage,
  | 'isAsyncEncryptionAvailable'
  | 'encryptStringAsync'
  | 'decryptStringAsync'
  | 'getSelectedStorageBackend'
>;

/** The seal of the key before a rotation: what the last release's sync `encryptString` wrote. */
export const SEAL_PREVIOUS = 'test-keychain:';
/** The seal of the key after a rotation. */
export const SEAL_ROTATED = 'test-keychain-rotated:';

export interface TestSafeStorageOptions {
  /** `isAsyncEncryptionAvailable()`; default true. */
  available?: boolean;
  /** `getSelectedStorageBackend()`; default `gnome_libsecret`. */
  backend?: ReturnType<SafeStorage['getSelectedStorageBackend']>;
  /**
   * The keychain key has rotated: new seals use `SEAL_ROTATED`, and a
   * `SEAL_PREVIOUS` seal still opens but asks for re-encryption.
   */
  rotated?: boolean;
}

export function testSafeStorage(options: TestSafeStorageOptions = {}): TestSafeStorage {
  const { available = true, backend = 'gnome_libsecret', rotated = false } = options;
  const currentSeal = rotated ? SEAL_ROTATED : SEAL_PREVIOUS;
  return {
    isAsyncEncryptionAvailable: async () => available,
    getSelectedStorageBackend: () => backend,
    encryptStringAsync: async (plainText: string) =>
      Buffer.from(`${currentSeal}${plainText}`, 'utf8'),
    decryptStringAsync: async (encrypted: Buffer) => {
      const text = encrypted.toString('utf8');
      if (text.startsWith(currentSeal)) {
        return { shouldReEncrypt: false, result: text.slice(currentSeal.length) };
      }
      if (rotated && text.startsWith(SEAL_PREVIOUS)) {
        return { shouldReEncrypt: true, result: text.slice(SEAL_PREVIOUS.length) };
      }
      throw new Error('Not sealed by the test keychain');
    },
  };
}

export function electronWithTestKeychain(): { safeStorage: TestSafeStorage } {
  return { safeStorage: testSafeStorage() };
}
