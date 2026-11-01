import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';

interface SqliteStatement {
  all(...params: unknown[]): unknown[];
  get(...params: unknown[]): unknown;
  run(...params: unknown[]): unknown;
}
interface SqliteDatabase {
  exec(sql: string): void;
  prepare(sql: string): SqliteStatement;
}

/**
 * The app's better-sqlite3 build targets Electron's ABI and cannot load under a
 * plain Node test runner, so these run against Node 24's bundled `node:sqlite`
 * — a real SQLite, not a stand-in. What is under test is the SQL: whether the
 * migrations leave the physical constraints the drizzle schema declares, and
 * what SQLite then does on delete. Neither can be proved by reading the schema
 * file, because the schema and the database disagreed until 0031.
 *
 * `node:sqlite` enables foreign keys by default (better-sqlite3 does not), so
 * every connection here opts out explicitly and turns enforcement on where the
 * app does — after migrations.
 *
 * The repo's @types/node is still on 20, so the shapes used are declared above
 * rather than imported. Same approach as core/utils/sql-like.test.ts.
 */
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as {
  DatabaseSync: new (
    path: string,
    options?: { enableForeignKeyConstraints?: boolean }
  ) => SqliteDatabase;
};

const drizzleDir = fileURLToPath(new URL('../../../drizzle/', import.meta.url));

const journal = JSON.parse(readFileSync(`${drizzleDir}meta/_journal.json`, 'utf8')) as {
  entries: { idx: number; tag: string }[];
};

/**
 * Mirrors runBundledMigrations (db/initialize.ts): statements split on the
 * drizzle breakpoint and applied inside one transaction. The transaction is
 * the point — it is what makes the `PRAGMA foreign_keys=OFF` lines baked into
 * migrations 0006 and 0017 no-ops, so enforcement has to be held off around
 * the whole run instead.
 */
function applyMigrations(db: SqliteDatabase, tags: string[]): void {
  db.exec('BEGIN');
  for (const tag of tags) {
    const sql = readFileSync(`${drizzleDir}${tag}.sql`, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint')) {
      const trimmed = statement.trim();
      if (trimmed) db.exec(trimmed);
    }
  }
  db.exec('COMMIT');
}

const allTags = journal.entries.map((entry) => entry.tag);
const tagsBefore = (tag: string): string[] => allTags.slice(0, allTags.indexOf(tag));

function openMigrated(tags: string[] = allTags): SqliteDatabase {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  applyMigrations(db, tags);
  return db;
}

function seedWorkItem(db: SqliteDatabase, id: string, repoId: string | null): void {
  db.prepare('INSERT INTO work_items (id, name, repo_id, repo_path) VALUES (?, ?, ?, ?)').run(
    id,
    `item ${id}`,
    repoId,
    '/tmp/repo'
  );
  db.prepare('INSERT INTO agent_sessions (id, work_item_id) VALUES (?, ?)').run(`s-${id}`, id);
  db.prepare(
    'INSERT INTO chat_messages (id, work_item_id, session_id, sender_type, content) VALUES (?, ?, ?, ?, ?)'
  ).run(`m-${id}`, id, `s-${id}`, 'human', 'hello');
  db.prepare('INSERT INTO artifacts (id, work_item_id, file_path, name) VALUES (?, ?, ?, ?)').run(
    `a-${id}`,
    id,
    `/tmp/repo/${id}.md`,
    'plan'
  );
  db.prepare(
    'INSERT INTO work_item_tickets (id, work_item_id, ticket_id, ticket_provider) VALUES (?, ?, ?, ?)'
  ).run(`t-${id}`, id, 'ENG-1', 'linear');
  db.prepare(
    'INSERT INTO checkpoints (id, work_item_id, commit_sha, git_ref) VALUES (?, ?, ?, ?)'
  ).run(`c-${id}`, id, 'abc123', 'refs/chord/checkpoints/c');
}

function countIn(db: SqliteDatabase, table: string, workItemId: string): number {
  const row = db
    .prepare(`SELECT count(*) AS n FROM ${table} WHERE work_item_id = ?`)
    .get(workItemId) as { n: number };
  return row.n;
}

function foreignKeysOf(
  db: SqliteDatabase,
  table: string
): { from: string; table: string; on_delete: string }[] {
  return db.prepare(`PRAGMA foreign_key_list(${table})`).all() as {
    from: string;
    table: string;
    on_delete: string;
  }[];
}

describe('local database foreign key enforcement', () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openMigrated();
    db.exec('PRAGMA foreign_keys = ON');
  });

  it('enforces foreign keys once the pragma is set', () => {
    const row = db.prepare('PRAGMA foreign_keys').get() as { foreign_keys: number };
    expect(row.foreign_keys).toBe(1);
  });

  it('gives work_items.repo_id the ON DELETE SET NULL the schema declares', () => {
    const repoFk = foreignKeysOf(db, 'work_items').find((fk) => fk.from === 'repo_id');
    expect(repoFk).toMatchObject({ table: 'repos', on_delete: 'SET NULL' });
  });

  it('cascades a work item delete to its children', () => {
    seedWorkItem(db, 'w1', null);
    seedWorkItem(db, 'w2', null);

    db.prepare('DELETE FROM work_items WHERE id = ?').run('w1');

    for (const table of ['agent_sessions', 'chat_messages', 'artifacts', 'work_item_tickets']) {
      expect(countIn(db, table, 'w1')).toBe(0);
      expect(countIn(db, table, 'w2')).toBe(1);
    }
    expect(countIn(db, 'checkpoints', 'w1')).toBe(0);
  });

  it('clears repo_id instead of failing when a repo with work items is deleted', () => {
    db.prepare('INSERT INTO repos (id, path, alias) VALUES (?, ?, ?)').run(
      'r1',
      '/tmp/repo',
      'repo'
    );
    seedWorkItem(db, 'w1', 'r1');

    expect(() => db.prepare('DELETE FROM repos WHERE id = ?').run('r1')).not.toThrow();

    const row = db.prepare('SELECT repo_id FROM work_items WHERE id = ?').get('w1') as {
      repo_id: string | null;
    };
    expect(row.repo_id).toBeNull();
  });

  it('accepts an ingested message whose session belongs to another device', () => {
    seedWorkItem(db, 'w1', null);

    // What chat-ingestion.ts writes for a teammate's agent turn: a session id
    // that only exists in the producing device's agent_sessions.
    expect(() =>
      db
        .prepare(
          'INSERT INTO chat_messages (id, work_item_id, session_id, sender_type, content) VALUES (?, ?, ?, ?, ?)'
        )
        .run('m-remote', 'w1', 'session-on-another-device', 'agent', 'from a teammate')
    ).not.toThrow();
  });

  it('rejects a child row whose work item does not exist', () => {
    expect(() =>
      db
        .prepare(
          'INSERT INTO chat_messages (id, work_item_id, sender_type, content) VALUES (?, ?, ?, ?)'
        )
        .run('m-orphan', 'no-such-work-item', 'human', 'hello')
    ).toThrow(/FOREIGN KEY/i);
  });
});

describe('0030 chat_messages rebuild', () => {
  const migration = '0030_drop_chat_message_session_fk';

  it('carries existing messages through the rebuild and drops only the session constraint', () => {
    const db = openMigrated(tagsBefore(migration));
    seedWorkItem(db, 'w1', null);
    db.prepare(
      'UPDATE chat_messages SET metadata = ?, cloud_id = ?, synced_at = ? WHERE id = ?'
    ).run('{"turnId":"t1"}', 'cloud-m1', 99, 'm-w1');

    applyMigrations(db, [migration]);

    expect(db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('m-w1')).toMatchObject({
      id: 'm-w1',
      work_item_id: 'w1',
      session_id: 's-w1',
      sender_type: 'human',
      content: 'hello',
      metadata: '{"turnId":"t1"}',
      cloud_id: 'cloud-m1',
      synced_at: 99,
    });

    const fks = foreignKeysOf(db, 'chat_messages');
    expect(fks.map((fk) => fk.from)).toEqual(['work_item_id']);
    expect(fks[0]).toMatchObject({ table: 'work_items', on_delete: 'CASCADE' });
  });
});

describe('0031 orphan sweep', () => {
  const migration = '0031_repair_local_fk_integrity';

  it('removes children left behind by deletes that never cascaded, and keeps checkpoints', () => {
    const db = openMigrated(tagsBefore(migration));

    seedWorkItem(db, 'w1', 'repo-deleted-long-ago');
    // The state the inert cascades produced: the parent goes, children stay.
    db.prepare('DELETE FROM work_items WHERE id = ?').run('w1');
    expect(countIn(db, 'chat_messages', 'w1')).toBe(1);

    applyMigrations(db, [migration]);

    for (const table of ['chat_messages', 'agent_sessions', 'artifacts', 'work_item_tickets']) {
      expect(countIn(db, table, 'w1')).toBe(0);
    }
    // Kept on purpose: the row is the only record of the git ref it pins.
    expect(countIn(db, 'checkpoints', 'w1')).toBe(1);
  });

  it('nulls a repo_id pointing at a repo that is already gone', () => {
    const db = openMigrated(tagsBefore(migration));
    seedWorkItem(db, 'w1', 'repo-deleted-long-ago');

    applyMigrations(db, [migration]);

    const row = db.prepare('SELECT repo_id FROM work_items WHERE id = ?').get('w1') as {
      repo_id: string | null;
    };
    expect(row.repo_id).toBeNull();
  });

  it('preserves work item columns across the table rebuild', () => {
    const db = openMigrated(tagsBefore(migration));
    db.prepare('INSERT INTO repos (id, path, alias) VALUES (?, ?, ?)').run('r1', '/tmp/r', 'r');
    db.prepare(
      'INSERT INTO work_items (id, name, status, repo_id, repo_path, branch_name, model, cloud_id, cloud_version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('w1', 'ship it', 'active', 'r1', '/tmp/r', 'feat/x', 'opus', 'cloud-1', 7, 111, 222);

    applyMigrations(db, [migration]);

    expect(db.prepare('SELECT * FROM work_items WHERE id = ?').get('w1')).toMatchObject({
      id: 'w1',
      name: 'ship it',
      status: 'active',
      repo_id: 'r1',
      repo_path: '/tmp/r',
      branch_name: 'feat/x',
      model: 'opus',
      cloud_id: 'cloud-1',
      cloud_version: 7,
      created_at: 111,
      updated_at: 222,
    });
  });
});
