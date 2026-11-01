import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from './migration-files.js';

/**
 * 0020_notification_facts turns a notification from a finished sentence into
 * facts (shared-items step 2, N1): who acted, on which team, comment or chat
 * message, and an excerpt; the app builds the sentence from the roster. The
 * rows written before it hold only sentences, so it deletes them. `title` and
 * `body` stay, nullable, until the renderer stops reading them (0021).
 * Replays 0000–0019 on a real (PGlite) Postgres, seeds old rows, applies 0020.
 */
describe('migration 0020_notification_facts', () => {
  const pg = new PGlite();
  const migrations = loadMigrations();
  const target = migrations.find((m) => m.name.startsWith('0020_'));

  beforeAll(async () => {
    for (const migration of migrations.filter((m) => m.version < 20)) {
      await pg.exec(migration.sql);
    }

    await pg.exec(`
      INSERT INTO users (id, email) VALUES ('author', 'author@x.dev'), ('mate', 'mate@x.dev');
      INSERT INTO organizations (id, name) VALUES ('org', 'team');
      INSERT INTO work_items (id, org_id, creator_id, name) VALUES ('w', 'org', 'author', 'item');
      INSERT INTO artifacts (id, work_item_id, name) VALUES ('a', 'w', 'plan.md');
      INSERT INTO artifact_comments (id, artifact_id, author_id, author_name, body)
        VALUES ('c', 'a', 'mate', 'Mate', 'looks good');
      INSERT INTO notifications (id, user_id, type, title, body, work_item_id) VALUES
        ('old-share', 'mate', 'share_invite', 'author@x.dev shared item', NULL, 'w'),
        ('old-mention', 'mate', 'mention', 'author mentioned you', 'hi', 'w'),
        ('old-invite', 'mate', 'team_invite', 'author invited you to join the team', 'mate@x.dev', NULL);
    `);

    if (!target) throw new Error('0020_notification_facts migration is missing');
    await pg.exec(target.sql);
  });

  afterAll(async () => {
    await pg.close();
  });

  async function rows<T>(sql: string): Promise<T[]> {
    return (await pg.query<T>(sql)).rows;
  }

  async function failureCode(sql: string): Promise<string | null> {
    try {
      await pg.exec(sql);
      return null;
    } catch (err) {
      return (err as { code?: string }).code ?? 'unknown';
    }
  }

  it('adds the fact columns, all optional, and makes the title optional', async () => {
    const columns = await rows<{ column_name: string; is_nullable: string; data_type: string }>(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns
       WHERE table_name = 'notifications'
         AND column_name IN ('actor_user_id', 'org_id', 'comment_id', 'message_id', 'excerpt', 'title')
       ORDER BY column_name`
    );
    expect(columns).toEqual([
      { column_name: 'actor_user_id', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'comment_id', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'excerpt', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'message_id', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'org_id', is_nullable: 'YES', data_type: 'text' },
      { column_name: 'title', is_nullable: 'YES', data_type: 'text' },
    ]);
  });

  it('deletes the rows written as sentences', async () => {
    expect(await rows(`SELECT id FROM notifications`)).toEqual([]);
  });

  it('round-trips a row that holds only facts', async () => {
    await pg.exec(`
      INSERT INTO notifications (id, user_id, type, actor_user_id, work_item_id, artifact_id, comment_id, excerpt)
        VALUES ('n-comment', 'author', 'artifact_comment', 'mate', 'w', 'a', 'c', 'looks good');
      INSERT INTO notifications (id, user_id, type, actor_user_id, work_item_id, message_id, excerpt)
        VALUES ('n-mention', 'mate', 'mentioned', 'author', 'w', 'msg-1', 'can you check');
      INSERT INTO notifications (id, user_id, type, actor_user_id, org_id)
        VALUES ('n-invite', 'mate', 'team_invite', 'author', 'org');
    `);
    expect(
      await rows(
        `SELECT id, type, actor_user_id, org_id, work_item_id, artifact_id, comment_id, message_id,
                excerpt, title, body, read
         FROM notifications ORDER BY id`
      )
    ).toEqual([
      {
        id: 'n-comment',
        type: 'artifact_comment',
        actor_user_id: 'mate',
        org_id: null,
        work_item_id: 'w',
        artifact_id: 'a',
        comment_id: 'c',
        message_id: null,
        excerpt: 'looks good',
        title: null,
        body: null,
        read: false,
      },
      {
        id: 'n-invite',
        type: 'team_invite',
        actor_user_id: 'author',
        org_id: 'org',
        work_item_id: null,
        artifact_id: null,
        comment_id: null,
        message_id: null,
        excerpt: null,
        title: null,
        body: null,
        read: false,
      },
      {
        id: 'n-mention',
        type: 'mentioned',
        actor_user_id: 'author',
        org_id: null,
        work_item_id: 'w',
        artifact_id: null,
        comment_id: null,
        message_id: 'msg-1',
        excerpt: 'can you check',
        title: null,
        body: null,
        read: false,
      },
    ]);
  });

  it('refuses an excerpt longer than 200 characters', async () => {
    await pg.exec(`
      INSERT INTO notifications (id, user_id, type, excerpt)
        VALUES ('n-200', 'mate', 'mentioned', repeat('x', 200));
    `);
    expect(
      await failureCode(
        `INSERT INTO notifications (id, user_id, type, excerpt)
           VALUES ('n-201', 'mate', 'mentioned', repeat('x', 201))`
      )
    ).toBe('23514');
  });

  it('refuses an unknown actor, team or comment', async () => {
    expect(
      await failureCode(
        `INSERT INTO notifications (id, user_id, type, actor_user_id) VALUES ('x1', 'mate', 'mentioned', 'nobody')`
      )
    ).toBe('23503');
    expect(
      await failureCode(
        `INSERT INTO notifications (id, user_id, type, org_id) VALUES ('x2', 'mate', 'team_invite', 'missing')`
      )
    ).toBe('23503');
    expect(
      await failureCode(
        `INSERT INTO notifications (id, user_id, type, comment_id) VALUES ('x3', 'author', 'artifact_comment', 'missing')`
      )
    ).toBe('23503');
  });

  it('keeps the notification when its comment, team or actor is deleted', async () => {
    await pg.exec(`DELETE FROM artifact_comments WHERE id = 'c'`);
    expect(await rows(`SELECT comment_id FROM notifications WHERE id = 'n-comment'`)).toEqual([
      { comment_id: null },
    ]);

    await pg.exec(`
      INSERT INTO organizations (id, name) VALUES ('org2', 'other');
      INSERT INTO notifications (id, user_id, type, actor_user_id, org_id)
        VALUES ('n-invite2', 'mate', 'team_invite', 'author', 'org2');
      DELETE FROM organizations WHERE id = 'org2';
    `);
    expect(await rows(`SELECT org_id FROM notifications WHERE id = 'n-invite2'`)).toEqual([
      { org_id: null },
    ]);

    await pg.exec(`
      INSERT INTO users (id, email) VALUES ('gone', 'gone@x.dev');
      INSERT INTO notifications (id, user_id, type, actor_user_id, work_item_id)
        VALUES ('n-gone', 'mate', 'mentioned', 'gone', 'w');
      DELETE FROM users WHERE id = 'gone';
    `);
    expect(await rows(`SELECT actor_user_id FROM notifications WHERE id = 'n-gone'`)).toEqual([
      { actor_user_id: null },
    ]);
  });
});
