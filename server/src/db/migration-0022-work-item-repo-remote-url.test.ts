import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from './migration-files.js';

/**
 * 0022_work_item_repo_remote_url (shared-items step 3, H7): a work item carries
 * its repo's normalized origin, so a teammate's sidebar can put it in their own
 * group for the same repo. Nullable and additive: items from before it, and
 * items sent by older desktop builds, have none until the owner's app
 * backfills it. Replays 0000–0021 on a real (PGlite) Postgres and applies 0022.
 */
describe('migration 0022_work_item_repo_remote_url', () => {
  const pg = new PGlite();
  const migrations = loadMigrations();
  const target = migrations.find((m) => m.name.startsWith('0022_'));

  beforeAll(async () => {
    for (const migration of migrations.filter((m) => m.version < 22)) {
      await pg.exec(migration.sql);
    }
    await pg.exec(`
      INSERT INTO users (id, email) VALUES ('author', 'author@x.dev');
      INSERT INTO organizations (id, name) VALUES ('org', 'Team');
      INSERT INTO work_items (id, org_id, creator_id, name, repo_name)
        VALUES ('w1', 'org', 'author', 'Old item', 'chord');
    `);

    if (!target) throw new Error('0022_work_item_repo_remote_url migration is missing');
    await pg.exec(target.sql);
  });

  afterAll(async () => {
    await pg.close();
  });

  async function rows<T>(sql: string): Promise<T[]> {
    return (await pg.query<T>(sql)).rows;
  }

  it('adds a nullable repo_remote_url and leaves existing items without one', async () => {
    const [column] = await rows<{ is_nullable: string; data_type: string }>(
      `SELECT is_nullable, data_type FROM information_schema.columns
       WHERE table_name = 'work_items' AND column_name = 'repo_remote_url'`
    );
    expect(column).toEqual({ is_nullable: 'YES', data_type: 'text' });
    expect(await rows(`SELECT id, repo_name, repo_remote_url FROM work_items`)).toEqual([
      { id: 'w1', repo_name: 'chord', repo_remote_url: null },
    ]);
  });

  it('re-runs cleanly on a database that already has it', async () => {
    if (!target) throw new Error('0022_work_item_repo_remote_url migration is missing');
    await expect(pg.exec(target.sql)).resolves.toBeDefined();
  });
});
