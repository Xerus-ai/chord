import { createRequire } from 'node:module';
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { drizzle } from 'drizzle-orm/sqlite-proxy';
import { beforeEach, describe, expect, it } from 'vitest';
import { likeContains } from './sql-like';

const notes = sqliteTable('notes', {
  id: text('id').primaryKey(),
  body: text('body').notNull(),
});

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

/**
 * A real SQLite through drizzle's proxy driver: the app's better-sqlite3 build
 * targets Electron's ABI and cannot load under a plain Node test runner, but
 * the statement drizzle generates still has to be executed by SQLite itself —
 * an assertion on the generated string would not prove the ESCAPE clause works.
 *
 * Node 24 ships `node:sqlite`; the repo's @types/node is still on 20, so the
 * shape of the two calls used here is declared above rather than imported.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (path: string) => SqliteDatabase;
};

let sqlite: SqliteDatabase;
const db = drizzle(async (sql, params) => ({
  rows: sqlite
    .prepare(sql)
    .all(...params)
    .map((row) => Object.values(row as Record<string, unknown>)),
}));

async function bodiesMatching(query: string): Promise<string[]> {
  const rows = await db
    .select({ body: notes.body })
    .from(notes)
    .where(likeContains(notes.body, query));
  return rows.map((row) => row.body);
}

describe('likeContains', () => {
  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec('CREATE TABLE notes (id TEXT PRIMARY KEY, body TEXT NOT NULL)');
    const insert = sqlite.prepare('INSERT INTO notes (id, body) VALUES (?, ?)');
    const seed = [
      'deploy_script needs review',
      'deployXscript is a different file',
      'progress is at 50% today',
      'progress is at 51% today',
      'a literal back\\slash here',
      'plain text',
    ];
    seed.forEach((body, index) => insert.run(String(index), body));
  });

  it('treats _ as a literal underscore, not a single-character wildcard', async () => {
    await expect(bodiesMatching('deploy_script')).resolves.toEqual(['deploy_script needs review']);
  });

  it('treats % as a literal percent, not a match-anything wildcard', async () => {
    await expect(bodiesMatching('50%')).resolves.toEqual(['progress is at 50% today']);
  });

  it('matches a literal backslash rather than consuming the next character', async () => {
    await expect(bodiesMatching('back\\slash')).resolves.toEqual(['a literal back\\slash here']);
  });

  it('still matches an ordinary substring anywhere in the value', async () => {
    await expect(bodiesMatching('progress is at')).resolves.toHaveLength(2);
    await expect(bodiesMatching('nothing here')).resolves.toEqual([]);
  });
});
