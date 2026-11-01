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
 * Companion to foreign-keys.test.ts, split out to keep both files under the
 * 400-line limit; same node:sqlite approach (see that file's header comment
 * for why). Covers the 0034 work_item_worktrees table: the ON DELETE
 * SET NULL / CASCADE its rebuild gives agent_sessions.worktree_id and
 * checkpoints.worktree_id (plain ALTER TABLE ADD COLUMN cannot carry
 * ON DELETE — see 0034's comment and 0031's precedent for work_items.repo_id),
 * the partial unique "one primary per work item" index, and the backfill.
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
const migration = '0034_closed_gabe_jones';

function openMigrated(tags: string[] = allTags): SqliteDatabase {
  const db = new DatabaseSync(':memory:', { enableForeignKeyConstraints: false });
  applyMigrations(db, tags);
  return db;
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

function indexNamesOf(db: SqliteDatabase, table: string): string[] {
  return (db.prepare(`PRAGMA index_list(${table})`).all() as { name: string }[]).map(
    (row) => row.name
  );
}

/** Seeds a work item with one primary worktree and one session/checkpoint on it. */
function seedWorkItemWithWorktree(db: SqliteDatabase, id: string): string {
  const worktreeId = `wt-${id}`;
  db.prepare('INSERT INTO work_items (id, name, repo_path) VALUES (?, ?, ?)').run(
    id,
    `item ${id}`,
    '/tmp/repo'
  );
  db.prepare(
    'INSERT INTO work_item_worktrees (id, work_item_id, path, is_primary) VALUES (?, ?, ?, 1)'
  ).run(worktreeId, id, '/tmp/repo');
  db.prepare('INSERT INTO agent_sessions (id, work_item_id, worktree_id) VALUES (?, ?, ?)').run(
    `s-${id}`,
    id,
    worktreeId
  );
  db.prepare(
    'INSERT INTO checkpoints (id, work_item_id, commit_sha, git_ref, worktree_id) VALUES (?, ?, ?, ?, ?)'
  ).run(`c-${id}`, id, 'abc123', 'refs/chord/checkpoints/c', worktreeId);
  return worktreeId;
}

describe('work_item_worktrees foreign keys and cascades', () => {
  let db: SqliteDatabase;

  beforeEach(() => {
    db = openMigrated();
    db.exec('PRAGMA foreign_keys = ON');
  });

  it('declares the physical constraints the schema promises', () => {
    const worktreeFk = foreignKeysOf(db, 'work_item_worktrees').find(
      (fk) => fk.from === 'work_item_id'
    );
    expect(worktreeFk).toMatchObject({ table: 'work_items', on_delete: 'CASCADE' });

    const sessionFk = foreignKeysOf(db, 'agent_sessions').find((fk) => fk.from === 'worktree_id');
    expect(sessionFk).toMatchObject({ table: 'work_item_worktrees', on_delete: 'SET NULL' });

    const checkpointFk = foreignKeysOf(db, 'checkpoints').find((fk) => fk.from === 'worktree_id');
    expect(checkpointFk).toMatchObject({ table: 'work_item_worktrees', on_delete: 'CASCADE' });
  });

  it('cascades a work item delete to its worktree rows', () => {
    seedWorkItemWithWorktree(db, 'w1');
    seedWorkItemWithWorktree(db, 'w2');

    db.prepare('DELETE FROM work_items WHERE id = ?').run('w1');

    const remaining = db.prepare('SELECT work_item_id FROM work_item_worktrees').all() as {
      work_item_id: string;
    }[];
    expect(remaining.map((row) => row.work_item_id)).toEqual(['w2']);
  });

  it('nulls agent_sessions.worktree_id and deletes checkpoints when a worktree row is deleted', () => {
    const worktreeId = seedWorkItemWithWorktree(db, 'w1');

    db.prepare('DELETE FROM work_item_worktrees WHERE id = ?').run(worktreeId);

    const session = db
      .prepare('SELECT worktree_id FROM agent_sessions WHERE id = ?')
      .get('s-w1') as {
      worktree_id: string | null;
    };
    expect(session.worktree_id).toBeNull();

    const checkpointCount = db
      .prepare('SELECT count(*) AS n FROM checkpoints WHERE id = ?')
      .get('c-w1') as { n: number };
    expect(checkpointCount.n).toBe(0);
  });

  it('rejects a second primary worktree for the same work item', () => {
    db.prepare('INSERT INTO work_items (id, name, repo_path) VALUES (?, ?, ?)').run(
      'w1',
      'item w1',
      '/tmp/repo'
    );
    db.prepare(
      'INSERT INTO work_item_worktrees (id, work_item_id, path, is_primary) VALUES (?, ?, ?, 1)'
    ).run('wt-1', 'w1', '/tmp/repo');

    expect(() =>
      db
        .prepare(
          'INSERT INTO work_item_worktrees (id, work_item_id, path, is_primary) VALUES (?, ?, ?, 1)'
        )
        .run('wt-2', 'w1', '/tmp/repo-2')
    ).toThrow(/UNIQUE/i);
  });

  it('allows a second non-primary worktree for the same work item', () => {
    db.prepare('INSERT INTO work_items (id, name, repo_path) VALUES (?, ?, ?)').run(
      'w1',
      'item w1',
      '/tmp/repo'
    );
    db.prepare(
      'INSERT INTO work_item_worktrees (id, work_item_id, path, is_primary) VALUES (?, ?, ?, 1)'
    ).run('wt-1', 'w1', '/tmp/repo');

    expect(() =>
      db
        .prepare(
          'INSERT INTO work_item_worktrees (id, work_item_id, path, is_primary) VALUES (?, ?, ?, 0)'
        )
        .run('wt-2', 'w1', '/tmp/repo-2')
    ).not.toThrow();
  });

  it('allows two work items to each have a primary worktree at the same path', () => {
    db.prepare('INSERT INTO work_items (id, name, repo_path) VALUES (?, ?, ?)').run(
      'w1',
      'item w1',
      '/tmp/shared-repo'
    );
    db.prepare('INSERT INTO work_items (id, name, repo_path) VALUES (?, ?, ?)').run(
      'w2',
      'item w2',
      '/tmp/shared-repo'
    );

    expect(() => {
      db.prepare(
        'INSERT INTO work_item_worktrees (id, work_item_id, path, is_primary) VALUES (?, ?, ?, 1)'
      ).run('wt-1', 'w1', '/tmp/shared-repo');
      db.prepare(
        'INSERT INTO work_item_worktrees (id, work_item_id, path, is_primary) VALUES (?, ?, ?, 1)'
      ).run('wt-2', 'w2', '/tmp/shared-repo');
    }).not.toThrow();
  });
});

describe('0034 agent_sessions/checkpoints rebuild', () => {
  it('preserves every column across the table rebuild and keeps their indexes', () => {
    const db = openMigrated(tagsBefore(migration));
    db.prepare('INSERT INTO work_items (id, name, repo_path) VALUES (?, ?, ?)').run(
      'w1',
      'ship it',
      '/tmp/repo'
    );
    db.prepare(
      `INSERT INTO agent_sessions
        (id, work_item_id, kind, agent_provider_id, communication, external_session_id,
         title, cwd, status, respawn_count, provision_status, created_at, last_active_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      's1',
      'w1',
      'terminal',
      'claude-code',
      'acp',
      'ext-1',
      'my session',
      '/tmp/repo/sub',
      'active',
      2,
      'ready',
      111,
      222
    );
    db.prepare(
      `INSERT INTO checkpoints
        (id, work_item_id, turn_id, session_id, commit_sha, git_ref, trigger, branch_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      'c1',
      'w1',
      'turn-1',
      's1',
      'deadbeef',
      'refs/chord/checkpoints/c1',
      'pre_revert',
      'feat/x',
      333
    );

    applyMigrations(db, [migration]);

    expect(db.prepare('SELECT * FROM agent_sessions WHERE id = ?').get('s1')).toMatchObject({
      id: 's1',
      work_item_id: 'w1',
      kind: 'terminal',
      agent_provider_id: 'claude-code',
      communication: 'acp',
      external_session_id: 'ext-1',
      title: 'my session',
      cwd: '/tmp/repo/sub',
      status: 'active',
      respawn_count: 2,
      provision_status: 'ready',
      created_at: 111,
      last_active_at: 222,
    });
    expect(db.prepare('SELECT * FROM checkpoints WHERE id = ?').get('c1')).toMatchObject({
      id: 'c1',
      work_item_id: 'w1',
      turn_id: 'turn-1',
      session_id: 's1',
      commit_sha: 'deadbeef',
      git_ref: 'refs/chord/checkpoints/c1',
      trigger: 'pre_revert',
      branch_name: 'feat/x',
      created_at: 333,
    });

    expect(indexNamesOf(db, 'agent_sessions')).toEqual(
      expect.arrayContaining([
        'idx_agent_sessions_work_item_id',
        'idx_agent_sessions_status',
        'idx_agent_sessions_worktree_id',
      ])
    );
    expect(indexNamesOf(db, 'checkpoints')).toEqual(
      expect.arrayContaining(['idx_checkpoints_work_item_id'])
    );
  });
});

describe('0034 backfill', () => {
  it('gives every pre-existing work item exactly one primary worktree and rewires sessions and checkpoints', () => {
    const db = openMigrated(tagsBefore(migration));

    // Two work items sharing a repo root (pre-worktree items point repo_path
    // at the repo root, so duplicates are expected), one with a NULL
    // branch_name — the common case (12/14 real rows).
    db.prepare(
      'INSERT INTO work_items (id, name, repo_path, branch_name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('w1', 'item w1', '/tmp/shared-repo', null, 100);
    db.prepare(
      'INSERT INTO work_items (id, name, repo_path, branch_name, created_at) VALUES (?, ?, ?, ?, ?)'
    ).run('w2', 'item w2', '/tmp/shared-repo', 'feat/y', 200);
    db.prepare('INSERT INTO agent_sessions (id, work_item_id) VALUES (?, ?)').run('s1', 'w1');
    db.prepare('INSERT INTO agent_sessions (id, work_item_id) VALUES (?, ?)').run('s2', 'w2');
    db.prepare(
      'INSERT INTO checkpoints (id, work_item_id, commit_sha, git_ref) VALUES (?, ?, ?, ?)'
    ).run('c1', 'w1', 'sha1', 'refs/chord/checkpoints/c1');
    db.prepare(
      'INSERT INTO checkpoints (id, work_item_id, commit_sha, git_ref) VALUES (?, ?, ?, ?)'
    ).run('c2', 'w2', 'sha2', 'refs/chord/checkpoints/c2');
    // Orphan checkpoint left behind by a work item deleted before 0031's
    // sweep (0031 keeps these on purpose). 0034 must not throw on it and
    // must leave its worktree_id NULL.
    db.prepare(
      'INSERT INTO checkpoints (id, work_item_id, commit_sha, git_ref) VALUES (?, ?, ?, ?)'
    ).run('c-orphan', 'work-item-deleted-long-ago', 'sha3', 'refs/chord/checkpoints/orphan');

    expect(() => applyMigrations(db, [migration])).not.toThrow();

    const worktrees = db
      .prepare('SELECT * FROM work_item_worktrees ORDER BY work_item_id')
      .all() as {
      work_item_id: string;
      path: string;
      branch_name: string | null;
      is_primary: number;
      created_at: number;
    }[];
    expect(worktrees).toHaveLength(2);
    expect(worktrees[0]).toMatchObject({
      work_item_id: 'w1',
      path: '/tmp/shared-repo',
      branch_name: null,
      is_primary: 1,
      created_at: 100,
    });
    expect(worktrees[1]).toMatchObject({
      work_item_id: 'w2',
      path: '/tmp/shared-repo',
      branch_name: 'feat/y',
      is_primary: 1,
      created_at: 200,
    });

    const worktreeIdOf = (workItemId: string): string =>
      (
        db.prepare('SELECT id FROM work_item_worktrees WHERE work_item_id = ?').get(workItemId) as {
          id: string;
        }
      ).id;

    expect(
      (
        db.prepare('SELECT worktree_id FROM agent_sessions WHERE id = ?').get('s1') as {
          worktree_id: string;
        }
      ).worktree_id
    ).toBe(worktreeIdOf('w1'));
    expect(
      (
        db.prepare('SELECT worktree_id FROM agent_sessions WHERE id = ?').get('s2') as {
          worktree_id: string;
        }
      ).worktree_id
    ).toBe(worktreeIdOf('w2'));
    expect(
      (
        db.prepare('SELECT worktree_id FROM checkpoints WHERE id = ?').get('c1') as {
          worktree_id: string;
        }
      ).worktree_id
    ).toBe(worktreeIdOf('w1'));
    expect(
      (
        db.prepare('SELECT worktree_id FROM checkpoints WHERE id = ?').get('c2') as {
          worktree_id: string;
        }
      ).worktree_id
    ).toBe(worktreeIdOf('w2'));
    expect(
      (
        db.prepare('SELECT worktree_id FROM checkpoints WHERE id = ?').get('c-orphan') as {
          worktree_id: string | null;
        }
      ).worktree_id
    ).toBeNull();
  });
});
