import { join } from 'node:path';
import { app } from 'electron';

/**
 * Root directory of this instance's profile (userData). CHORD_PROFILE
 * switches it so a second dev instance can run under a different account.
 * Deliberately independent of app.setPath ordering: the local DB (which
 * holds the encrypted account secrets) opens at module-import time, before
 * index.ts gets a chance to call setPath.
 */
export function resolveProfileDir(): string {
  return join(app.getPath('appData'), process.env.CHORD_PROFILE?.trim() || 'chord');
}
