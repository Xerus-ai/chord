import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from './migration-files.js';

/**
 * 0024_artifact_status (devstation-664): an artifact's status is the owner's,
 * one of the app's four (draft, in_review, approved, built), or none while the
 * owner's app has not sent it. The old default 'in_progress' was never the
 * owner's word and is not the app's: rows holding it are cleared, the default
 * is dropped, and the column takes only the four. Replays 0000–0023 on a real
 * (PGlite) Postgres and applies 0024.
 */
describe('migration 0024_artifact_status', () => {
  const pg = new PGlite();
  const migrations = loadMigrations();
  const target = migrations.find((m) => m.name.startsWith('0024_'));

  beforeAll(async () => {
    for (const migration of migrations.filter((m) => m.version < 24)) {
      await pg.exec(migration.sql);
    }
    await pg.exec(`
      INSERT INTO users (id, email) VALUES ('author', 'author@x.dev');
      INSERT INTO organizations (id, name) VALUES ('org', 'Team');
      INSERT INTO work_items (id, org_id, creator_id, name) VALUES ('w1', 'org', 'author', 'Item');
      INSERT INTO artifacts (id, work_item_id, name) VALUES ('a-default', 'w1', 'default.md');
      INSERT INTO artifacts (id, work_item_id, name, status)
        VALUES ('a-approved', 'w1', 'approved.md', 'approved');
      INSERT INTO artifacts (id, work_item_id, name, status)
        VALUES ('a-stray', 'w1', 'stray.md', 'active');
    `);

    if (!target) throw new Error('0024_artifact_status migration is missing');
    await pg.exec(target.sql);
  });

  afterAll(async () => {
    await pg.close();
  });

  async function rows<T>(sql: string): Promise<T[]> {
    return (await pg.query<T>(sql)).rows;
  }

  it("clears the old default and any other word that is not the owner's, and keeps a real one", async () => {
    expect(await rows(`SELECT id, status FROM artifacts ORDER BY id`)).toEqual([
      { id: 'a-approved', status: 'approved' },
      { id: 'a-default', status: null },
      { id: 'a-stray', status: null },
    ]);
  });

  it('a new artifact has no status until the owner sends one', async () => {
    await pg.exec(`INSERT INTO artifacts (id, work_item_id, name) VALUES ('a-new', 'w1', 'n.md')`);
    expect(await rows(`SELECT status FROM artifacts WHERE id = 'a-new'`)).toEqual([
      { status: null },
    ]);
  });

  it("takes the app's four statuses and nothing else", async () => {
    for (const status of ['draft', 'in_review', 'approved', 'built']) {
      await pg.exec(`UPDATE artifacts SET status = '${status}' WHERE id = 'a-new'`);
    }
    await expect(
      pg.exec(`UPDATE artifacts SET status = 'in_progress' WHERE id = 'a-new'`)
    ).rejects.toThrow(/ck_artifacts_status/);
  });

  it('re-runs cleanly on a database that already has it', async () => {
    if (!target) throw new Error('0024_artifact_status migration is missing');
    await expect(pg.exec(target.sql)).resolves.toBeDefined();
  });
});
