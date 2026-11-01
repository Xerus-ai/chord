import { resolve } from 'node:path';
import { resolveProfileDir } from '@main/app/profile';
import { resolveDefaultDatabasePath } from './database-file';
import { CURRENT_DB_FILENAME } from './default-path';

export interface ResolveDatabasePathOptions {
  userDataPath?: string;
}

export function resolveDatabasePath(options: ResolveDatabasePathOptions = {}): string {
  const explicitDbFile = process.env.CHORD_DB_FILE?.trim();
  if (explicitDbFile) {
    return resolve(explicitDbFile);
  }

  // resolveProfileDir, not app.getPath('userData'): this runs at module-import
  // time, before index.ts has applied the profile via app.setPath.
  return resolveDefaultDatabasePath(options.userDataPath ?? resolveProfileDir());
}

export const databaseFilenames = {
  current: CURRENT_DB_FILENAME,
};
