import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from './migration-files.js';

/**
 * 0021_drop_notification_sentences finishes what 0020 started (shared-items
 * step 2, N2): once no producer writes a title and no client reads one, the
 * sentence columns go, and the daily retention delete (read rows older than 30
 * days) gets an index instead of scanning every user's notifications.
 * Replays 0000–0020 on a real (PGlite) Postgres and applies 0021.
 */
describe('migration 0021_drop_notification_sentences', () => {
  const pg = new PGlite();
  const migrations = loadMigrations();
  const target = migrations.find((m) => m.name.startsWith('0021_'));

  beforeAll(async () => {
    for (const migration of migrations.filter((m) => m.version < 21)) {
      await pg.exec(migration.sql);
    }
    await pg.exec(`
      INSERT INTO users (id, email) VALUES ('mate', 'mate@x.dev'), ('author', 'author@x.dev');
      INSERT INTO notifications (id, user_id, type, actor_user_id, excerpt)
        VALUES ('n1', 'mate', 'mentioned', 'author', 'look');
    `);

    if (!target) throw new Error('0021_drop_notification_sentences migration is missing');
    await pg.exec(target.sql);
  });

  afterAll(async () => {
    await pg.close();
  });

  async function rows<T>(sql: string): Promise<T[]> {
    return (await pg.query<T>(sql)).rows;
  }

  it('drops title and body and keeps the facts', async () => {
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'notifications' AND column_name IN ('title', 'body', 'excerpt')`
    );
    expect(columns).toEqual([{ column_name: 'excerpt' }]);
    expect(await rows(`SELECT id, actor_user_id, excerpt FROM notifications`)).toEqual([
      { id: 'n1', actor_user_id: 'author', excerpt: 'look' },
    ]);
  });

  it('indexes read rows by age for the retention delete', async () => {
    const [index] = await rows<{ indexdef: string }>(
      `SELECT indexdef FROM pg_indexes WHERE indexname = 'idx_notifications_read_created'`
    );
    expect(index?.indexdef).toContain('(created_at)');
    expect(index?.indexdef).toContain('WHERE (read = true)');
  });
});
