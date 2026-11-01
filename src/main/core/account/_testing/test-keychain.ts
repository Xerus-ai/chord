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
 * Imports nothing: the `electron` mock factory loads this module, and any
 * import that reaches `electron` again would wait on the factory forever.
 */
export function electronWithTestKeychain(): { safeStorage: Record<string, unknown> } {
  return {
    safeStorage: {
      isEncryptionAvailable: () => true,
      getSelectedStorageBackend: () => 'gnome_libsecret',
      encryptString: (value: string) => Buffer.from(`test-keychain:${value}`, 'utf8'),
      decryptString: (encrypted: Buffer) => {
        const text = encrypted.toString('utf8');
        if (!text.startsWith('test-keychain:')) throw new Error('Not sealed by the test keychain');
        return text.slice('test-keychain:'.length);
      },
    },
  };
}
