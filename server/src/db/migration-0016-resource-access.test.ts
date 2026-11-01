import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadMigrations } from './migration-files.js';

/**
 * 0016_resource_access moves live sharing data into the P6 model. Replays
 * 0000–0015 on a real (PGlite) Postgres, seeds rows in the OLD shape, applies
 * 0016 and checks every mapping the design names (the P6 sharing design §2).
 */
describe('migration 0016_resource_access', () => {
  const pg = new PGlite();
  const migrations = loadMigrations();
  const target = migrations.find((m) => m.name.startsWith('0016_'));

  beforeAll(async () => {
    for (const migration of migrations.filter((m) => m.version < 16)) {
      await pg.exec(migration.sql);
    }

    await pg.exec(`
      INSERT INTO users (id, email) VALUES
        ('author', 'author@x.dev'), ('editor', 'editor@x.dev'), ('viewer', 'viewer@x.dev');
      INSERT INTO organizations (id, name) VALUES ('org', 'team');
      INSERT INTO work_items (id, org_id, creator_id, name, sharing_level) VALUES
        ('w_private', 'org', 'author', 'p', 'private'),
        ('w_team', 'org', 'author', 't', 'team'),
        ('w_org', 'org', 'author', 'o', 'org'),
        ('w_public', 'org', 'author', 'pub', 'public');
      INSERT INTO share_tokens (id, work_item_id, created_by, token, role, invited_email, expires_at, revoked) VALUES
        ('t_pending', 'w_private', 'author', 'raw1', 'viewer', 'new@x.dev', now() + interval '1 day', false),
        ('t_expired', 'w_private', 'author', 'raw2', 'viewer', 'old@x.dev', now() - interval '1 day', false),
        ('t_revoked', 'w_private', 'author', 'raw3', 'viewer', 'gone@x.dev', now() + interval '1 day', true),
        ('t_link', 'w_private', 'author', 'raw4', 'participant', NULL, now() + interval '1 day', false);
      INSERT INTO work_item_participants (work_item_id, user_id, role, joined_via_token_id) VALUES
        ('w_private', 'author', 'owner', NULL),
        ('w_private', 'editor', 'participant', NULL),
        ('w_private', 'viewer', 'viewer', 't_link');
    `);

    if (!target) throw new Error('0016_resource_access migration is missing');
    await pg.exec(target.sql);
  });

  afterAll(async () => {
    await pg.close();
  });

  async function rows<T>(sql: string): Promise<T[]> {
    return (await pg.query<T>(sql)).rows;
  }

  it('maps participants to members and drops the owner row', async () => {
    const members = await rows<{ user_id: string; role: string; granted_by: string }>(
      `SELECT user_id, role, granted_by FROM resource_members
       WHERE work_item_id = 'w_private' AND user_id IS NOT NULL ORDER BY user_id`
    );
    expect(members).toEqual([
      { user_id: 'editor', role: 'edit', granted_by: 'author' },
      { user_id: 'viewer', role: 'view', granted_by: 'author' },
    ]);
  });

  it('keeps only live email invites, as pending members', async () => {
    const pending = await rows<{ invited_email: string; role: string }>(
      `SELECT invited_email, role FROM resource_members WHERE user_id IS NULL`
    );
    expect(pending).toEqual([{ invited_email: 'new@x.dev', role: 'view' }]);
  });

  it('maps team/org to team edit and closes public', async () => {
    const items = await rows<{ id: string; general_access: string; general_role: string }>(
      `SELECT id, general_access, general_role FROM work_items ORDER BY id`
    );
    expect(items).toEqual([
      { id: 'w_org', general_access: 'team', general_role: 'edit' },
      { id: 'w_private', general_access: 'invited', general_role: 'view' },
      { id: 'w_public', general_access: 'invited', general_role: 'view' },
      { id: 'w_team', general_access: 'team', general_role: 'edit' },
    ]);
  });

  it('drops the old tables and column', async () => {
    const tables = await rows<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_name IN ('work_item_participants', 'share_tokens')`
    );
    expect(tables).toEqual([]);
    const columns = await rows<{ column_name: string }>(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name = 'work_items' AND column_name = 'sharing_level'`
    );
    expect(columns).toEqual([]);
  });

  it('adds the org switches, on by default', async () => {
    const [org] = await rows<{ allow_public_links: boolean; allow_confluence_publishing: boolean }>(
      `SELECT allow_public_links, allow_confluence_publishing FROM organizations WHERE id = 'org'`
    );
    expect(org).toEqual({ allow_public_links: true, allow_confluence_publishing: true });
  });

  it('refuses a public work item and a link artifact that grants edit', async () => {
    await expect(
      pg.exec(`UPDATE work_items SET general_access = 'link' WHERE id = 'w_private'`)
    ).rejects.toThrow();
    await pg.exec(`INSERT INTO artifacts (id, work_item_id, name) VALUES ('a1', 'w_private', 'a')`);
    await expect(
      pg.exec(`UPDATE artifacts SET general_access = 'link', general_role = 'edit' WHERE id = 'a1'`)
    ).rejects.toThrow();
  });

  it('allows one live public link per artifact', async () => {
    await pg.exec(`INSERT INTO artifacts (id, work_item_id, name) VALUES ('a2', 'w_private', 'a')`);
    await pg.exec(`INSERT INTO share_links (id, artifact_id, work_item_id, token_hash, created_by)
                   VALUES ('l1', 'a2', 'w_private', 'h1', 'author')`);
    await expect(
      pg.exec(`INSERT INTO share_links (id, artifact_id, work_item_id, token_hash, created_by)
               VALUES ('l2', 'a2', 'w_private', 'h2', 'author')`)
    ).rejects.toThrow();
    await pg.exec(`UPDATE share_links SET revoked_at = now() WHERE id = 'l1'`);
    await pg.exec(`INSERT INTO share_links (id, artifact_id, work_item_id, token_hash, created_by)
                   VALUES ('l2', 'a2', 'w_private', 'h2', 'author')`);
  });

  it('refuses a member row that is both a user and a pending email', async () => {
    await expect(
      pg.exec(`INSERT INTO resource_members (id, work_item_id, user_id, invited_email, role, granted_by)
               VALUES ('m_bad', 'w_private', 'editor', 'e@x.dev', 'view', 'author')`)
    ).rejects.toThrow();
  });
});
