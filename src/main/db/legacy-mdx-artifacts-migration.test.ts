import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Rows created before `mdx` was a content type carry `markdown` with an `.mdx`
 * path. MDX is now a page (design 2026-09-24 §9 decision 2), so a shipped
 * migration retypes them — otherwise they would keep the document render
 * class and never get a view.
 *
 * A retyped row that already reached the cloud is registered there as a
 * markdown document. The migration clears its `synced_at`, which puts it back
 * in the set the startup reconcile registers (sync-queue-service
 * reconcileLocalArtifacts): the server's artifact create is an upsert that
 * rewrites content_type and render_class, and a successful send stamps
 * `synced_at` again — durable until delivered, then never repeated.
 *
 * The migrations are replayed on a real SQLite (`node:sqlite`, as
 * `_testing/migrated-test-db.ts` does): everything before the retyping
 * migration, then legacy rows, then the rest.
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

const RETYPES_LEGACY_MDX = /UPDATE\s+[`"]?artifacts[`"]?\s+SET[\s\S]*?'mdx'/i;

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

describe('legacy .mdx artifacts migration', () => {
  it('retypes markdown rows with an .mdx path to mdx, marks them for re-registration, and leaves everything else alone', () => {
    const tags = journalTags();
    const at = tags.findIndex((tag) => RETYPES_LEGACY_MDX.test(migrationSql(tag)));
    expect(at, 'no shipped migration retypes legacy .mdx artifacts').toBeGreaterThanOrEqual(0);

    const database = openDatabase();
    apply(database, tags.slice(0, at));

    database.exec("INSERT INTO repos (id, alias, path) VALUES ('r-legacy', 'repo', '/tmp/legacy')");
    database.exec(
      "INSERT INTO work_items (id, repo_id, repo_path, name) VALUES ('w-legacy', 'r-legacy', '/tmp/legacy', 'Legacy')"
    );
    const insert = database.prepare(
      'INSERT INTO artifacts (id, work_item_id, file_path, name, type, content_type, cloud_id, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    );
    const SYNCED = 1_790_000_000;
    // Synced legacy row: registered in the cloud as a markdown document.
    insert.run(
      'a-legacy',
      'w-legacy',
      '/tmp/legacy/flow.mdx',
      'flow.mdx',
      'markdown',
      'markdown',
      'a-legacy',
      SYNCED
    );
    // Never synced: the reconcile registers it anyway, now as mdx.
    insert.run(
      'a-upper',
      'w-legacy',
      '/tmp/legacy/FLOW.MDX',
      'FLOW.MDX',
      'markdown',
      'markdown',
      null,
      null
    );
    insert.run(
      'a-plain',
      'w-legacy',
      '/tmp/legacy/plan.md',
      'plan.md',
      'markdown',
      'markdown',
      'a-plain',
      SYNCED
    );
    insert.run(
      'a-mdx',
      'w-legacy',
      '/tmp/legacy/new.mdx',
      'new.mdx',
      'mdx',
      'mdx',
      'a-mdx',
      SYNCED
    );
    insert.run(
      'a-web',
      'w-legacy',
      '/tmp/legacy/page.html',
      'page.html',
      'web',
      'web',
      'a-web',
      SYNCED
    );

    apply(database, tags.slice(at));

    const rows = database
      .prepare('SELECT id, type, content_type, synced_at FROM artifacts ORDER BY id')
      .all() as Array<{ id: string; type: string; content_type: string; synced_at: number | null }>;
    expect(rows.map((row) => ({ ...row }))).toEqual([
      { id: 'a-legacy', type: 'mdx', content_type: 'mdx', synced_at: null },
      // Already registered as mdx; the server's own migration reclassifies it.
      { id: 'a-mdx', type: 'mdx', content_type: 'mdx', synced_at: SYNCED },
      { id: 'a-plain', type: 'markdown', content_type: 'markdown', synced_at: SYNCED },
      { id: 'a-upper', type: 'mdx', content_type: 'mdx', synced_at: null },
      { id: 'a-web', type: 'web', content_type: 'web', synced_at: SYNCED },
    ]);
  });
});
