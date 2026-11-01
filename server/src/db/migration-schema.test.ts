import { describe, expect, it } from 'vitest';
import type { Migration } from './migration-files.js';
import { buildSchemaFromMigrations } from './migration-schema.js';

/**
 * The parser behind the column-level coverage guard. Every case here is a shape
 * that already exists in server/src/db/migrations/ — get one wrong and the
 * guard either passes a missing column or fails a present one.
 */

function migration(sql: string, version = 0): Migration {
  return { name: `${String(version).padStart(4, '0')}_test.sql`, version, sql, checksum: 'x' };
}

function parse(...sql: string[]) {
  return buildSchemaFromMigrations(sql.map((text, index) => migration(text, index)));
}

describe('buildSchemaFromMigrations', () => {
  it('reads columns off CREATE TABLE and ignores table constraints', () => {
    const schema = parse(`
      CREATE TABLE IF NOT EXISTS work_items (
        id text PRIMARY KEY,
        org_id text NOT NULL REFERENCES organizations(id),
        metadata jsonb DEFAULT '{}'::jsonb,
        "trigger" text NOT NULL DEFAULT 'auto',
        PRIMARY KEY (id, org_id),
        CONSTRAINT uq_work_items_org UNIQUE (org_id),
        FOREIGN KEY (org_id) REFERENCES organizations(id)
      );
    `);

    expect([...(schema.get('work_items') ?? [])].sort()).toEqual([
      'id',
      'metadata',
      'org_id',
      'trigger',
    ]);
  });

  it('applies ADD COLUMN across files, with or without IF NOT EXISTS', () => {
    const schema = parse(
      'CREATE TABLE share_tokens (id text PRIMARY KEY);',
      `ALTER TABLE share_tokens
         ADD COLUMN role text NOT NULL DEFAULT 'viewer',
         ADD COLUMN joined_via_token_id text REFERENCES share_tokens(id) ON DELETE SET NULL;`,
      'ALTER TABLE share_tokens ADD COLUMN IF NOT EXISTS invited_email text;'
    );

    expect([...(schema.get('share_tokens') ?? [])].sort()).toEqual([
      'id',
      'invited_email',
      'joined_via_token_id',
      'role',
    ]);
  });

  it('does not mistake constraint actions for columns', () => {
    const schema = parse(
      'CREATE TABLE chat_messages (id text PRIMARY KEY);',
      `ALTER TABLE chat_messages
         DROP CONSTRAINT chat_messages_work_item_id_fkey,
         ADD CONSTRAINT chat_messages_work_item_id_fkey
           FOREIGN KEY (work_item_id) REFERENCES work_items(id) ON DELETE CASCADE;`,
      'ALTER TABLE chat_messages ADD PRIMARY KEY (id);'
    );

    expect([...(schema.get('chat_messages') ?? [])]).toEqual(['id']);
  });

  it('applies DROP COLUMN and RENAME COLUMN', () => {
    const schema = parse(
      'CREATE TABLE presence (user_id text, stale text, old_name text);',
      'ALTER TABLE presence DROP COLUMN stale;',
      'ALTER TABLE presence RENAME COLUMN old_name TO active_view;'
    );

    expect([...(schema.get('presence') ?? [])].sort()).toEqual(['active_view', 'user_id']);
  });

  it('applies RENAME TO and DROP TABLE', () => {
    const renamed = parse(
      'CREATE TABLE tasks (id text);',
      'ALTER TABLE tasks RENAME TO work_items;'
    );
    expect(renamed.has('tasks')).toBe(false);
    expect([...(renamed.get('work_items') ?? [])]).toEqual(['id']);

    const dropped = parse('CREATE TABLE terminals (id text);', 'DROP TABLE IF EXISTS terminals;');
    expect(dropped.has('terminals')).toBe(false);
  });

  it('honours statement order within one file when a table is recreated', () => {
    const schema = parse(
      'DROP TABLE notifications; CREATE TABLE notifications (id text, read boolean);'
    );

    expect([...(schema.get('notifications') ?? [])].sort()).toEqual(['id', 'read']);
  });

  it('treats a re-run CREATE TABLE IF NOT EXISTS as a no-op, not a redefinition', () => {
    // 0000_baseline.sql is guarded and re-runnable; replaying it must not
    // discard columns that later migrations added.
    const schema = parse(
      'CREATE TABLE IF NOT EXISTS organizations (id text PRIMARY KEY);',
      'ALTER TABLE organizations ADD COLUMN plan text;',
      'CREATE TABLE IF NOT EXISTS organizations (id text PRIMARY KEY);'
    );

    expect([...(schema.get('organizations') ?? [])].sort()).toEqual(['id', 'plan']);
  });

  it('ignores commented-out statements', () => {
    const schema = parse(`
      CREATE TABLE users (id text);
      -- ALTER TABLE users ADD COLUMN email text;
      /* ALTER TABLE users ADD COLUMN name text; */
      -- CREATE TABLE ghost (id text);
    `);

    expect([...(schema.get('users') ?? [])]).toEqual(['id']);
    expect(schema.has('ghost')).toBe(false);
  });

  it('counts an ALTER inside a DO guard block', () => {
    const schema = parse(`
      CREATE TABLE artifacts (id text);
      DO $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'x') THEN
          ALTER TABLE artifacts ADD COLUMN content_type text;
        END IF;
      END $$;
    `);

    expect([...(schema.get('artifacts') ?? [])].sort()).toEqual(['content_type', 'id']);
  });

  it('does not let punctuation inside string literals split a statement', () => {
    const schema = parse(`
      CREATE TABLE workflows (
        id text PRIMARY KEY,
        template text NOT NULL DEFAULT 'a,b;c(d)',
        config jsonb DEFAULT '{"a": 1}'::jsonb
      );
    `);

    expect([...(schema.get('workflows') ?? [])].sort()).toEqual(['config', 'id', 'template']);
  });
});
