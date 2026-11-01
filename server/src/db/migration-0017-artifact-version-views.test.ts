import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from './migration-files.js';

/**
 * 0017_artifact_version_views adds the viewing model of P6 (the P6 sharing design §9): one self-contained HTML view per page
 * version, an idempotency key for uploaded versions, and MDX moving to the
 * page render class. Replays 0000–0016 on a real (PGlite) Postgres, seeds
 * rows in the old shape, applies 0017 and checks each change.
 */
describe('migration 0017_artifact_version_views', () => {
  const pg = new PGlite();
  const migrations = loadMigrations();
  const target = migrations.find((m) => m.name.startsWith('0017_'));

  beforeAll(async () => {
    for (const migration of migrations.filter((m) => m.version < 17)) {
      await pg.exec(migration.sql);
    }

    await pg.exec(`
      INSERT INTO users (id, email) VALUES ('author', 'author@x.dev');
      INSERT INTO organizations (id, name) VALUES ('org', 'team');
      INSERT INTO work_items (id, org_id, creator_id, name) VALUES ('w', 'org', 'author', 'item');
      INSERT INTO artifacts (id, work_item_id, name, content_type, render_class) VALUES
        ('a_mdx', 'w', 'chart.mdx', 'mdx', 'document'),
        ('a_md', 'w', 'plan.md', 'markdown', 'document'),
        ('a_web', 'w', 'index.html', 'web', 'page');
      INSERT INTO artifact_versions (id, artifact_id, document_name, version_number, content) VALUES
        ('v_web_1', 'a_web', 'artifact-a_web', 1, '<h1>1</h1>'),
        ('v_web_2', 'a_web', 'artifact-a_web', 2, '<h1>2</h1>'),
        ('v_md_1', 'a_md', 'artifact-a_md', 1, NULL);
    `);

    if (!target) throw new Error('0017_artifact_version_views migration is missing');
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

  it('moves mdx artifacts to the page render class and leaves the others alone', async () => {
    const artifacts = await rows<{ id: string; render_class: string }>(
      `SELECT id, render_class FROM artifacts ORDER BY id`
    );
    expect(artifacts).toEqual([
      { id: 'a_md', render_class: 'document' },
      { id: 'a_mdx', render_class: 'page' },
      { id: 'a_web', render_class: 'page' },
    ]);
  });

  it('creates artifact_version_views keyed by version', async () => {
    const columns = await rows<{ column_name: string; is_nullable: string; data_type: string }>(
      `SELECT column_name, is_nullable, data_type FROM information_schema.columns
       WHERE table_name = 'artifact_version_views' ORDER BY column_name`
    );
    expect(columns).toEqual([
      { column_name: 'byte_size', is_nullable: 'NO', data_type: 'integer' },
      { column_name: 'created_at', is_nullable: 'NO', data_type: 'timestamp with time zone' },
      { column_name: 'html', is_nullable: 'NO', data_type: 'text' },
      { column_name: 'version_id', is_nullable: 'NO', data_type: 'text' },
    ]);

    await pg.exec(
      `INSERT INTO artifact_version_views (version_id, html, byte_size) VALUES ('v_web_1', '<p>view</p>', 11)`
    );
    // One view per version.
    expect(
      await failureCode(
        `INSERT INTO artifact_version_views (version_id, html, byte_size) VALUES ('v_web_1', 'again', 5)`
      )
    ).toBe('23505');
    // A view belongs to a real version.
    expect(
      await failureCode(
        `INSERT INTO artifact_version_views (version_id, html, byte_size) VALUES ('missing', 'x', 1)`
      )
    ).toBe('23503');
  });

  it('deletes a view with its version', async () => {
    await pg.exec(
      `INSERT INTO artifact_version_views (version_id, html, byte_size) VALUES ('v_web_2', '<p>2</p>', 8)`
    );
    await pg.exec(`DELETE FROM artifact_versions WHERE id = 'v_web_2'`);
    const views = await rows<{ version_id: string }>(
      `SELECT version_id FROM artifact_version_views WHERE version_id = 'v_web_2'`
    );
    expect(views).toEqual([]);
  });

  it('makes client_version_id unique per artifact, and optional', async () => {
    const existing = await rows<{ client_version_id: string | null }>(
      `SELECT client_version_id FROM artifact_versions WHERE id = 'v_web_1'`
    );
    expect(existing).toEqual([{ client_version_id: null }]);

    await pg.exec(`
      INSERT INTO artifact_versions (id, artifact_id, document_name, version_number, client_version_id)
      VALUES ('v_md_2', 'a_md', 'artifact-a_md', 2, 'client-1'),
             ('v_md_3', 'a_md', 'artifact-a_md', 3, NULL),
             ('v_md_4', 'a_md', 'artifact-a_md', 4, NULL),
             ('v_web_3', 'a_web', 'artifact-a_web', 3, 'client-1');
    `);
    expect(
      await failureCode(`
        INSERT INTO artifact_versions (id, artifact_id, document_name, version_number, client_version_id)
        VALUES ('v_md_5', 'a_md', 'artifact-a_md', 5, 'client-1')
      `)
    ).toBe('23505');
  });
});
