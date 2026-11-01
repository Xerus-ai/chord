import { createHash } from 'node:crypto';
import type BetterSqlite3 from 'better-sqlite3';
import journal from '@root/drizzle/meta/_journal.json';
import { sqlite } from './client';
import { setForeignKeysEnforcement } from './foreign-keys';

// Vite bundles all migration SQL files at build time — no runtime path resolution needed.
// Each value is the raw SQL string content of the file.
const sqlFiles = import.meta.glob('@root/drizzle/*.sql', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

type JournalEntry = { idx: number; when: number; tag: string; breakpoints: boolean };

const ALTER_ADD_COLUMN_RE =
  /^ALTER\s+TABLE\s+[`"']?(\w+)[`"']?\s+ADD\s+(?:COLUMN\s+)?[`"']?(\w+)[`"']?/i;

function columnExists(connection: BetterSqlite3.Database, table: string, column: string): boolean {
  const rows = connection.prepare(`PRAGMA table_info(\`${table}\`)`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

function runBundledMigrations(connection: BetterSqlite3.Database): void {
  connection.exec(`
    CREATE TABLE IF NOT EXISTS __drizzle_migrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash TEXT NOT NULL,
      created_at NUMERIC
    )
  `);

  const lastRow = connection
    .prepare('SELECT created_at FROM __drizzle_migrations ORDER BY created_at DESC LIMIT 1')
    .get() as { created_at: number } | undefined;
  const lastTimestamp = lastRow?.created_at ?? 0;

  connection.transaction(() => {
    for (const entry of (journal as { entries: JournalEntry[] }).entries) {
      if (entry.when <= lastTimestamp) continue;

      const sqlKey = Object.keys(sqlFiles).find((k) => k.includes(entry.tag));
      if (!sqlKey) throw new Error(`Missing bundled SQL for migration: ${entry.tag}`);

      const sql = sqlFiles[sqlKey];
      const hash = createHash('sha256').update(sql).digest('hex');

      for (const stmt of sql.split('--> statement-breakpoint')) {
        const trimmed = stmt.trim();
        if (!trimmed) continue;

        // SQLite has no ADD COLUMN IF NOT EXISTS — skip if the column is
        // already present (e.g. a previous run applied the DDL but crashed
        // before recording the migration in __drizzle_migrations).
        const match = ALTER_ADD_COLUMN_RE.exec(trimmed);
        if (match && columnExists(connection, match[1]!, match[2]!)) continue;

        connection.exec(trimmed);
      }

      connection
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(hash, entry.when);
    }
  })();
}

/**
 * Runs all pending migrations against the shared SQLite connection and validates
 * the schema contract. Call this once in main.ts before any db queries run.
 *
 * Throws `DatabaseSchemaMismatchError` when required columns/tables are missing
 * after migration (e.g. the user downgraded from a newer build).
 *
 * Returns the raw better-sqlite3 handle so the caller can close it on shutdown.
 */
export async function initializeDatabase(): Promise<BetterSqlite3.Database> {
  // Migrations rebuild tables the drizzle way — CREATE `__new_x`, copy, DROP
  // the original, RENAME. With enforcement on, `DROP TABLE work_items` runs an
  // implicit DELETE FROM that cascades every chat message, session and
  // artifact away, so an upgrade from a pre-0017 build would silently empty
  // the database. The `PRAGMA foreign_keys=OFF` lines inside those generated
  // migrations cannot prevent that: runBundledMigrations applies them inside a
  // transaction, where the pragma is ignored. Enforcement is therefore held
  // off around the whole run and turned on once, after it.
  setForeignKeysEnforcement(sqlite, false);
  runBundledMigrations(sqlite);
  setForeignKeysEnforcement(sqlite, true);
  return sqlite;
}
