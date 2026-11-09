import { and, eq } from 'drizzle-orm';
import { safeStorage, type SafeStorage } from 'electron';
import { db as appDb } from '@main/db/client';
import { appSecrets } from '@main/db/schema';
import { log } from '@main/lib/logger';

/**
 * The async safeStorage API the store uses. Electron 45 deprecates the sync
 * `encryptString` / `decryptString` / `isEncryptionAvailable` and 46 removes
 * them; a ciphertext the sync API sealed opens with `decryptStringAsync`.
 */
export type AsyncSafeStorage = Pick<
  SafeStorage,
  | 'isAsyncEncryptionAvailable'
  | 'encryptStringAsync'
  | 'decryptStringAsync'
  | 'getSelectedStorageBackend'
>;

export class EncryptedAppSecretsStore {
  constructor(
    private readonly db = appDb,
    private readonly safeStorageApi: AsyncSafeStorage = safeStorage,
    private readonly platform: NodeJS.Platform = process.platform
  ) {}

  async getSecret(key: string): Promise<string | null> {
    const rows = await this.db
      .select({ secret: appSecrets.secret })
      .from(appSecrets)
      .where(eq(appSecrets.key, key))
      .limit(1);

    const secret = rows[0]?.secret;
    if (!secret) {
      return null;
    }

    await this.assertSecureStorageAvailable();
    const { result, shouldReEncrypt } = await this.safeStorageApi.decryptStringAsync(
      Buffer.from(secret, 'base64')
    );
    if (shouldReEncrypt) {
      await this.reseal(key, secret, result);
    }
    return result;
  }

  async setSecret(key: string, secret: string): Promise<void> {
    await this.assertSecureStorageAvailable();
    const encryptedSecret = (await this.safeStorageApi.encryptStringAsync(secret)).toString(
      'base64'
    );

    await this.setEncryptedSecret(key, encryptedSecret);
  }

  async setEncryptedSecret(key: string, encryptedSecret: string): Promise<void> {
    await this.db
      .insert(appSecrets)
      .values({
        key: key,
        secret: encryptedSecret,
      })
      .onConflictDoUpdate({ target: appSecrets.key, set: { secret: encryptedSecret } })
      .execute();
  }

  async deleteSecret(key: string): Promise<void> {
    await this.db.delete(appSecrets).where(eq(appSecrets.key, key));
  }

  /**
   * Seals a secret again under the keychain's current key, when
   * `decryptStringAsync` asks for it. The write is a compare-and-swap on the
   * ciphertext that was read, so a set or delete that landed meanwhile is
   * never undone.
   *
   * A failed re-seal is logged and the read stands. This is deliberate, not a
   * fallback: the old seal still opens, nothing default is returned, and
   * propagating the error would turn a good read into a sign-out
   * (`credential-store` maps errors to null).
   */
  private async reseal(key: string, readSecret: string, value: string): Promise<void> {
    try {
      const resealed = (await this.safeStorageApi.encryptStringAsync(value)).toString('base64');
      await this.db
        .update(appSecrets)
        .set({ secret: resealed })
        .where(and(eq(appSecrets.key, key), eq(appSecrets.secret, readSecret)));
    } catch (error) {
      log.warn(`[secrets] could not re-seal ${key}; the stored seal still opens`, error);
    }
  }

  private async assertSecureStorageAvailable(): Promise<void> {
    if (!(await this.safeStorageApi.isAsyncEncryptionAvailable())) {
      throw new Error('Secure secret storage is unavailable on this system.');
    }

    if (this.platform !== 'linux') {
      return;
    }

    const backend = this.safeStorageApi.getSelectedStorageBackend();
    if (backend === 'basic_text') {
      throw new Error(
        'Secure secret storage is unavailable: Linux safeStorage backend is basic_text.'
      );
    }
  }
}

export const encryptedAppSecretsStore = new EncryptedAppSecretsStore();
