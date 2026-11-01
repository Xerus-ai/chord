import { join } from 'node:path';
import { CURRENT_DB_FILENAME } from './default-path';

export function resolveDefaultDatabasePath(userDataPath: string): string {
  return join(userDataPath, CURRENT_DB_FILENAME);
}
