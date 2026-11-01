import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from './migration-files.js';

/**
 * 0019_artifact_comment_reads records, per account and artifact, when the
 * account last read the artifact's comments (shared-items step 1, S8): the
 * rail's unread dot is "another person commented after this". Replays
 * 0000–0018 on a real (PGlite) Postgres, applies 0019 and checks the table.
 */
describe('migration 0019_artifact_comment_reads', () => {
  const pg = new PGlite();
  const migrations = loadMigrations();
  const target = migrations.find((m) => m.name.startsWith('0019_'));

  beforeAll(async () => {
    for (const migration of migrations.filter((m) => m.version < 19)) {
      await pg.exec(migration.sql);
    }

    await pg.exec(`
      INSERT INTO users (id, email) VALUES ('author', 'author@x.dev'), ('mate', 'mate@x.dev');
      INSERT INTO organizations (id, name) VALUES ('org', 'team');
      INSERT INTO work_items (id, org_id, creator_id, name) VALUES ('w', 'org', 'author', 'item');
      INSERT INTO artifacts (id, work_item_id, name) VALUES ('a1', 'w', 'plan.md'), ('a2', 'w', 'notes.md');
    `);

    if (!target) throw new Error('0019_artifact_comment_reads migration is missing');
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

  it('creates artifact_comment_reads with a required read time', async () => {
    const columns = await rows<{ column_name: string; is_nullable: string; data_type: string }>(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns
       WHERE table_name = 'artifact_comment_reads' ORDER BY column_name`
    );
    expect(columns).toEqual([
      { column_name: 'artifact_id', is_nullable: 'NO', data_type: 'text' },
      { column_name: 'last_read_at', is_nullable: 'NO', data_type: 'timestamp with time zone' },
      { column_name: 'user_id', is_nullable: 'NO', data_type: 'text' },
    ]);
  });

  it('keeps one read per account and artifact', async () => {
    await pg.exec(`
      INSERT INTO artifact_comment_reads (user_id, artifact_id) VALUES
        ('author', 'a1'), ('mate', 'a1'), ('author', 'a2');
    `);
    expect(
      await failureCode(
        `INSERT INTO artifact_comment_reads (user_id, artifact_id) VALUES ('author', 'a1')`
      )
    ).toBe('23505');
  });

  it('refuses a read of an unknown account or artifact', async () => {
    expect(
      await failureCode(
        `INSERT INTO artifact_comment_reads (user_id, artifact_id) VALUES ('nobody', 'a1')`
      )
    ).toBe('23503');
    expect(
      await failureCode(
        `INSERT INTO artifact_comment_reads (user_id, artifact_id) VALUES ('author', 'missing')`
      )
    ).toBe('23503');
  });

  it('deletes the reads with their artifact and with their account', async () => {
    await pg.exec(`DELETE FROM artifacts WHERE id = 'a2'`);
    expect(
      await rows(`SELECT user_id FROM artifact_comment_reads WHERE artifact_id = 'a2'`)
    ).toEqual([]);

    await pg.exec(`DELETE FROM users WHERE id = 'mate'`);
    expect(
      await rows(`SELECT artifact_id FROM artifact_comment_reads WHERE user_id = 'mate'`)
    ).toEqual([]);
  });
});
