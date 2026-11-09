import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

/**
 * The credential store under Electron 45's async safeStorage API, against the
 * real migrated database and the test keychain (`test-keychain.ts`), which
 * implements only the async API.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { appSecrets } = await import('@main/db/schema');
const { SEAL_PREVIOUS, SEAL_ROTATED, testSafeStorage } = await import(
  '@main/core/account/_testing/test-keychain'
);
const { EncryptedAppSecretsStore } = await import('./encrypted-app-secrets-store');

type KeychainOptions = Parameters<typeof testSafeStorage>[0];

function storeWith(options: KeychainOptions = {}, platform: NodeJS.Platform = 'win32') {
  return new EncryptedAppSecretsStore(db, testSafeStorage(options), platform);
}

function sealed(seal: string, value: string): string {
  return Buffer.from(`${seal}${value}`, 'utf8').toString('base64');
}

async function storedRow(key: string): Promise<string | undefined> {
  const rows = await db
    .select({ secret: appSecrets.secret })
    .from(appSecrets)
    .where(eq(appSecrets.key, key));
  return rows[0]?.secret;
}

describe('EncryptedAppSecretsStore under async safeStorage', () => {
  it('round-trips a secret through the async safeStorage API', async () => {
    const store = storeWith();
    await store.setSecret('round-trip', 'token-1');
    expect(await storedRow('round-trip')).toBe(sealed(SEAL_PREVIOUS, 'token-1'));
    expect(await store.getSecret('round-trip')).toBe('token-1');
  });

  it('reads a secret sealed by the sync encryptString of the last release', async () => {
    // Proves the row format only: base64 of the keychain's ciphertext, which the async API opens
    // (S1, Electron 45). That a real Electron 40 ciphertext opens under 45 is proven by the
    // packaged agent-terminals run, whose seed profile was signed in under Electron 40.
    const store = storeWith();
    await store.setEncryptedSecret('last-release', sealed(SEAL_PREVIOUS, 'token-40'));
    expect(await store.getSecret('last-release')).toBe('token-40');
  });

  it('refuses when async encryption is unavailable', async () => {
    await storeWith().setSecret('unavailable', 'kept');
    const store = storeWith({ available: false });
    await expect(store.setSecret('unavailable-new', 'x')).rejects.toThrow(/unavailable/);
    await expect(store.getSecret('unavailable')).rejects.toThrow(/unavailable/);
    expect(await storedRow('unavailable-new')).toBeUndefined();
  });

  it('refuses the Linux basic_text backend', async () => {
    const store = storeWith({ backend: 'basic_text' }, 'linux');
    await expect(store.setSecret('basic-text', 'x')).rejects.toThrow(/basic_text/);
    expect(await storedRow('basic-text')).toBeUndefined();
  });

  it('re-seals a secret when decryptStringAsync asks for re-encryption', async () => {
    const store = storeWith({ rotated: true });
    await store.setEncryptedSecret('rotated', sealed(SEAL_PREVIOUS, 'token-r'));
    expect(await store.getSecret('rotated')).toBe('token-r');
    expect(await storedRow('rotated')).toBe(sealed(SEAL_ROTATED, 'token-r'));
    expect(await store.getSecret('rotated')).toBe('token-r');
  });

  it('keeps the read and the row when the re-seal is refused', async () => {
    const keychain = {
      ...testSafeStorage({ rotated: true }),
      encryptStringAsync: () => Promise.reject(new Error('keychain locked')),
    };
    const store = new EncryptedAppSecretsStore(db, keychain, 'win32');
    await store.setEncryptedSecret('reseal-refused', sealed(SEAL_PREVIOUS, 'token-k'));
    expect(await store.getSecret('reseal-refused')).toBe('token-k');
    expect(await storedRow('reseal-refused')).toBe(sealed(SEAL_PREVIOUS, 'token-k'));
  });
});
