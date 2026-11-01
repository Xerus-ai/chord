import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { setForeignKeysEnforcement } from './foreign-keys';
import { resolveDatabasePath } from './path';
import * as schema from './schema';
import * as artifactSchema from './schema-artifacts';
import * as checkpointSchema from './schema-checkpoints';
import * as syncSchema from './schema-sync';
import * as workItemRelations from './schema-work-item-relations';
import * as workItemSchema from './schema-work-items';

const combinedSchema = {
  ...schema,
  ...workItemSchema,
  ...artifactSchema,
  ...checkpointSchema,
  ...workItemRelations,
  ...syncSchema,
};

export type AppDb = ReturnType<typeof drizzle<typeof combinedSchema>>;

// better-sqlite3 refuses to open a database whose parent directory is
// missing (fresh CHORD_PROFILE / CHORD_DB_FILE locations).
const databasePath = resolveDatabasePath();
mkdirSync(dirname(databasePath), { recursive: true });

export const sqlite = new Database(databasePath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('busy_timeout = 5000');
setForeignKeysEnforcement(sqlite, true);

export const db = drizzle(sqlite, { schema: combinedSchema });
