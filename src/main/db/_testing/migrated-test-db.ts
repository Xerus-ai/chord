import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/better-sqlite3';

/**
 * A real SQLite database built from the shipped migrations, for main-process
 * suites that drive real queries.
 *
 * The app's better-sqlite3 build targets Electron's ABI and cannot load under a
 * plain Node test runner, so the handle comes from Node's bundled `node:sqlite`
 * — a real SQLite, not a stand-in — behind the small adapter drizzle's
 * better-sqlite3 driver expects. Same technique as work-item-crud.test.ts and
 * other suites that carry their own copy; this is the
 * shared one for new suites.
 *
 * Lives under `_testing/` because vitest excludes `**\/_*\/**` from its test
 * globs, so the file is a helper and never a suite.
 */

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
  setReturnArrays(enabled: boolean): void;
}

interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

/**
 * drizzle's better-sqlite3 driver reads rows through `stmt.raw().get()` and
 * `stmt.raw().all()`, and runs multi-statement writes through
 * `db.transaction(fn)`'s deferred variant. `node:sqlite` expresses the same
 * column-array mode as `setReturnArrays`, and has no transaction wrapper of
 * its own, so both are supplied here.
 */
function adaptForDrizzle(database: SqliteDatabase): SqliteDatabase {
  return {
    exec: (sql) => database.exec(sql),
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
      const statement = database.prepare(sql);
      const wrapper = {
        run: (...params: unknown[]) => statement.run(...params),
        get: (...params: unknown[]) => statement.get(...params),
        all: (...params: unknown[]) => statement.all(...params),
        setReturnArrays: (enabled: boolean) => statement.setReturnArrays(enabled),
        raw: (enabled = true) => {
          statement.setReturnArrays(enabled);
          return wrapper;
        },
      };
      return wrapper as unknown as SqliteStatement;
    },
  } as SqliteDatabase;
}

const drizzleDir = fileURLToPath(new URL('../../../../drizzle/', import.meta.url));

/**
 * Every shipped migration, in journal order, inside one transaction — the same
 * shape as `runBundledMigrations` (db/initialize.ts). The transaction is what
 * makes the `PRAGMA foreign_keys=OFF` lines baked into some migrations no-ops,
 * so enforcement is held off around the whole run instead.
 */
function applyBundledMigrations(database: SqliteDatabase): void {
  const journal = JSON.parse(readFileSync(`${drizzleDir}meta/_journal.json`, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  database.exec('BEGIN');
  for (const entry of journal.entries) {
    const sql = readFileSync(`${drizzleDir}${entry.tag}.sql`, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) database.exec(trimmed);
    }
  }
  database.exec('COMMIT');
}

/** An in-memory database with the real schema, typed as the app's `db`. */
export function createMigratedTestDb() {
  const { DatabaseSync } = (
    process as unknown as { getBuiltinModule(id: string): unknown }
  ).getBuiltinModule('node:sqlite') as {
    DatabaseSync: new (
      path: string,
      options?: { enableForeignKeyConstraints?: boolean }
    ) => SqliteDatabase;
  };

  const database = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  applyBundledMigrations(database);
  database.exec('PRAGMA foreign_keys = ON');
  return drizzle(adaptForDrizzle(database) as never);
}
