import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * `localProject.branchPrefixMode` is new, and its default is `username`. A user
 * who had already typed a prefix (stored as an override of `branchPrefix`) or
 * cleared it must keep what they chose, so a shipped migration records the mode
 * their stored value meant: `''` → none, anything else → custom. Users with no
 * stored prefix get the new default.
 *
 * Replayed on a real SQLite (`node:sqlite`), as legacy-mdx-artifacts-migration.test.ts does.
 */

interface Statement {
  all(...params: unknown[]): unknown[];
  run(...params: unknown[]): unknown;
}

interface Database {
  exec(sql: string): void;
  prepare(sql: string): Statement;
}

const drizzleDir = fileURLToPath(new URL('../../../drizzle/', import.meta.url));

const RECORDS_BRANCH_PREFIX_MODE = /branchPrefixMode/;

function openDatabase(): Database {
  const { DatabaseSync } = (
    process as unknown as { getBuiltinModule(id: string): unknown }
  ).getBuiltinModule('node:sqlite') as {
    DatabaseSync: new (
      path: string,
      options?: { enableForeignKeyConstraints?: boolean }
    ) => Database;
  };
  return new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
}

function migrationSql(tag: string): string {
  return readFileSync(`${drizzleDir}${tag}.sql`, 'utf8');
}

function apply(database: Database, tags: string[]): void {
  database.exec('BEGIN');
  for (const tag of tags) {
    for (const statement of migrationSql(tag).split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) database.exec(trimmed);
    }
  }
  database.exec('COMMIT');
}

function journalTags(): string[] {
  const journal = JSON.parse(readFileSync(`${drizzleDir}meta/_journal.json`, 'utf8')) as {
    entries: { idx: number; tag: string }[];
  };
  return [...journal.entries].sort((a, b) => a.idx - b.idx).map((entry) => entry.tag);
}

/** The stored `localProject` row after migrating from `before`, or null if there is none. */
function migrateLocalProject(before: string, otherKey?: { key: string; value: string }): unknown {
  const tags = journalTags();
  const at = tags.findIndex((tag) => RECORDS_BRANCH_PREFIX_MODE.test(migrationSql(tag)));
  expect(at, 'no shipped migration records branchPrefixMode').toBeGreaterThanOrEqual(0);

  const database = openDatabase();
  apply(database, tags.slice(0, at));
  const insert = database.prepare('INSERT INTO app_settings (key, value) VALUES (?, ?)');
  insert.run('localProject', before);
  if (otherKey) insert.run(otherKey.key, otherKey.value);
  apply(database, tags.slice(at));

  if (otherKey) {
    const [other] = database
      .prepare('SELECT value FROM app_settings WHERE key = ?')
      .all(otherKey.key) as Array<{ value: string }>;
    expect(other?.value).toBe(otherKey.value);
  }
  const [row] = database
    .prepare("SELECT value FROM app_settings WHERE key = 'localProject'")
    .all() as Array<{ value: string }>;
  return row ? row.value : null;
}

describe('branch prefix mode migration', () => {
  it('keeps a typed prefix as custom mode', () => {
    const after = migrateLocalProject(
      '{"branchPrefix":"team","writeAgentConfigToGitIgnore":false}'
    );
    expect(JSON.parse(after as string)).toEqual({
      branchPrefix: 'team',
      writeAgentConfigToGitIgnore: false,
      branchPrefixMode: 'custom',
    });
  });

  it('keeps a cleared prefix as none mode', () => {
    const after = migrateLocalProject('{"branchPrefix":""}');
    expect(JSON.parse(after as string)).toEqual({ branchPrefix: '', branchPrefixMode: 'none' });
  });

  it('leaves a row with no stored prefix alone, so it takes the new default', () => {
    expect(migrateLocalProject('{"defaultWorktreeDirectory":"D:/lanes"}')).toBe(
      '{"defaultWorktreeDirectory":"D:/lanes"}'
    );
  });

  it('touches neither malformed values nor other settings', () => {
    expect(
      migrateLocalProject('not json', { key: 'notifications', value: '{"branchPrefix":"x"}' })
    ).toBe('not json');
  });
});
