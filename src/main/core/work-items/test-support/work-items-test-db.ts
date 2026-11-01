import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';

/**
 * A REAL SQLite database built from the shipped migrations, for tests that
 * drive the work-item state machine end to end. The app's better-sqlite3
 * build targets Electron's ABI, so the handle is `node:sqlite` adapted to the
 * surface drizzle's better-sqlite3 driver calls (same substitution as
 * script-approval.test.ts).
 *
 * One instance per test file: `@main/db/client` is mocked to `testDrizzle`,
 * and the test reads the same `testDb` directly.
 */
interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
  setReturnArrays(enabled: boolean): void;
}
export interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
  transaction?: unknown;
}

/**
 * drizzle's better-sqlite3 driver reads rows through `stmt.raw().get()` and
 * `stmt.raw().all()`. `node:sqlite` expresses the same column-array mode as
 * `setReturnArrays`.
 */
function adaptForDrizzle(database: SqliteDatabase): SqliteDatabase {
  return {
    exec: (sql) => database.exec(sql),
    // better-sqlite3's `db.transaction(fn)` returns a callable with
    // deferred/immediate/exclusive variants; drizzle invokes `.deferred(tx)`.
    // createWorkItem writes the work item and its primary worktree row in one.
    transaction: (fn: (...args: unknown[]) => unknown) => {
      const run =
        (begin: string) =>
        (...args: unknown[]) => {
          database.exec(begin);
          try {
            const result = fn(...args);
            database.exec('COMMIT');
            return result;
          } catch (error) {
            database.exec('ROLLBACK');
            throw error;
          }
        };
      return Object.assign(run('BEGIN'), {
        deferred: run('BEGIN DEFERRED'),
        immediate: run('BEGIN IMMEDIATE'),
        exclusive: run('BEGIN EXCLUSIVE'),
      });
    },
    prepare: (sql) => {
      const stmt = database.prepare(sql);
      const wrapper = {
        run: (...params: unknown[]) => stmt.run(...params),
        get: (...params: unknown[]) => stmt.get(...params),
        all: (...params: unknown[]) => stmt.all(...params),
        setReturnArrays: (enabled: boolean) => stmt.setReturnArrays(enabled),
        raw: (enabled = true) => {
          stmt.setReturnArrays(enabled);
          return wrapper;
        },
      };
      return wrapper as unknown as SqliteStatement;
    },
  };
}

function openInMemory(): SqliteDatabase {
  const { DatabaseSync } = (
    process as unknown as { getBuiltinModule(id: string): unknown }
  ).getBuiltinModule('node:sqlite') as {
    DatabaseSync: new (
      path: string,
      options?: { enableForeignKeyConstraints?: boolean }
    ) => SqliteDatabase;
  };
  return new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
}

const drizzleDir = fileURLToPath(new URL('../../../../../drizzle/', import.meta.url));

/**
 * Every shipped statement that touches these tables, in journal order — so the
 * tables under test cannot drift from the real schema, backfills included.
 */
function applyShippedMigrations(database: SqliteDatabase): void {
  const journal = JSON.parse(readFileSync(`${drizzleDir}meta/_journal.json`, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  for (const entry of journal.entries) {
    const sql = readFileSync(`${drizzleDir}${entry.tag}.sql`, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (
        trimmed &&
        (trimmed.includes('work_items') ||
          trimmed.includes('work_item_worktrees') ||
          trimmed.includes('work_item_tickets') ||
          trimmed.includes('repos'))
      ) {
        database.exec(trimmed);
      }
    }
  }
}

export const testDb = openInMemory();
applyShippedMigrations(testDb);
// As the app runs (`db/foreign-keys.ts`): migrations with the checks off,
// then on — so deleting a work item cascades to its lanes and tickets here too.
testDb.exec('PRAGMA foreign_keys = ON');

export const testDrizzle = drizzle(adaptForDrizzle(testDb) as never);
