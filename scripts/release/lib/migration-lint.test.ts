import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { lintMigrations, MIGRATION_LINT_BASELINE, type MigrationFile } from './migration-lint.ts';

/**
 * Release preflight's migration lint (design C5, F8; devstation-5s42). During a
 * deploy the old server keeps serving while the new release migrates, so a
 * migration that drops, renames or retypes a column, or adds a NOT NULL column
 * with no DEFAULT, breaks the server that is still live. Such a file ships only
 * as the contract half of expand/contract: its header names the released tag
 * that already stopped using what it removes.
 */

const MIGRATIONS = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '..',
  'server',
  'src',
  'db',
  'migrations'
);

function file(name: string, sql: string): MigrationFile {
  return { name, sql };
}

const TAGS = ['v1.0.0', 'v1.1.0-canary.2'];

describe('migration lint', () => {
  it('a drop column without a header fails', () => {
    const findings = lintMigrations(
      [file('0030_tidy.sql', 'ALTER TABLE work_items\n  DROP COLUMN legacy_title;\n')],
      { releasedTags: TAGS, after: 24 }
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].file).toBe('0030_tidy.sql');
    expect(findings[0].statement).toMatch(/DROP COLUMN legacy_title/i);
  });

  it('the contract-for header must name a released tag', () => {
    const sql = 'ALTER TABLE work_items DROP COLUMN legacy_title;';
    const released = lintMigrations(
      [
        file(
          '0030_tidy.sql',
          `-- contract-for: v1.0.0\n-- legacy_title unused since v1.0.0\n${sql}\n`
        ),
      ],
      { releasedTags: TAGS, after: 24 }
    );
    expect(released).toEqual([]);

    const unreleased = lintMigrations(
      [file('0030_tidy.sql', `-- contract-for: v9.9.9\n${sql}\n`)],
      { releasedTags: TAGS, after: 24 }
    );
    expect(unreleased).toHaveLength(1);
    expect(unreleased[0].reason).toMatch(/v9\.9\.9/);

    // A header further down the file, after SQL, is not the file's header.
    const buried = lintMigrations([file('0030_tidy.sql', `${sql}\n-- contract-for: v1.0.0\n`)], {
      releasedTags: TAGS,
      after: 24,
    });
    expect(buried).toHaveLength(1);
  });

  it('only destructive DDL is flagged', () => {
    const lint = (sql: string) =>
      lintMigrations([file('0031_x.sql', sql)], { releasedTags: TAGS, after: 24 }).map(
        (f) => f.statement
      );

    // Not destructive to a server still running the previous release.
    expect(lint('ALTER TABLE a DROP CONSTRAINT a_b_fkey;')).toEqual([]);
    expect(lint('DROP INDEX IF EXISTS a_b_idx;')).toEqual([]);
    expect(lint('ALTER TABLE a ALTER COLUMN title DROP NOT NULL;')).toEqual([]);
    expect(lint('ALTER TABLE a ALTER COLUMN status SET DEFAULT 0;')).toEqual([]);
    expect(lint('CREATE TABLE a (id text PRIMARY KEY, type text NOT NULL);')).toEqual([]);
    expect(lint('ALTER TABLE a ADD COLUMN n integer NOT NULL DEFAULT 0;')).toEqual([]);
    expect(
      lint(
        "ALTER TABLE a ADD COLUMN b text NOT NULL DEFAULT 'x' REFERENCES t ON DELETE SET DEFAULT;"
      )
    ).toEqual([]);
    expect(lint('ALTER TABLE a ADD COLUMN note text;')).toEqual([]);
    expect(lint('ALTER TABLE "odd;name" ADD COLUMN note text;')).toEqual([]);
    expect(lint("-- DROP TABLE a; is only a comment\nSELECT 'DROP TABLE a';")).toEqual([]);

    // Destructive.
    expect(lint('DROP TABLE IF EXISTS a;')).toHaveLength(1);
    expect(lint('ALTER TABLE a DROP COLUMN IF EXISTS b;')).toHaveLength(1);
    expect(lint('ALTER TABLE a DROP b;')).toHaveLength(1);
    expect(lint('ALTER TABLE a RENAME COLUMN b TO c;')).toHaveLength(1);
    expect(lint('ALTER TABLE a ALTER COLUMN b TYPE bigint;')).toHaveLength(1);
    expect(lint('ALTER TABLE a ALTER COLUMN b SET DATA TYPE bigint;')).toHaveLength(1);
    expect(lint('ALTER TABLE a ADD COLUMN n integer NOT NULL;')).toHaveLength(1);
    expect(lint('ALTER TABLE a ALTER COLUMN status DROP DEFAULT;')).toHaveLength(1);
    expect(lint('ALTER TABLE a ALTER COLUMN status SET NOT NULL;')).toHaveLength(1);
    expect(lint('ALTER TABLE a RENAME TO b;')).toHaveLength(1);
    expect(lint('ALTER TABLE a SET SCHEMA archive;')).toHaveLength(1);
    expect(lint('DROP VIEW IF EXISTS v;')).toHaveLength(1);
    expect(lint('DROP FUNCTION f();')).toHaveLength(1);
    expect(lint('TRUNCATE a;')).toHaveLength(1);
    expect(lint("ALTER TYPE mood RENAME VALUE 'sad' TO 'blue';")).toHaveLength(1);
    expect(lint('ALTER TABLE "odd;name" DROP COLUMN b;')).toHaveLength(1);
    // A foreign key's ON DELETE SET DEFAULT is not the column's DEFAULT.
    expect(
      lint('ALTER TABLE a ADD COLUMN b text NOT NULL REFERENCES t ON DELETE SET DEFAULT;')
    ).toHaveLength(1);
    // DDL inside a guarded DO block still runs.
    expect(
      lint(
        "DO $$ BEGIN IF EXISTS (SELECT 1 FROM t WHERE x = 'y') THEN ALTER TABLE a DROP COLUMN b; END IF; END $$;"
      )
    ).toHaveLength(1);
    // Each action of a multi-action ALTER counts.
    expect(
      lint('ALTER TABLE a\n  DROP COLUMN IF EXISTS b,\n  DROP COLUMN IF EXISTS c;')
    ).toHaveLength(1);
    expect(lint('ALTER TABLE a ADD COLUMN d text, DROP COLUMN b;')).toHaveLength(1);
  });

  it('the shipped set passes at its baseline', () => {
    const shipped = readdirSync(MIGRATIONS)
      .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
      .sort()
      .map((n) => file(n, readFileSync(join(MIGRATIONS, n), 'utf8')));
    expect(shipped.length).toBeGreaterThan(20);

    expect(lintMigrations(shipped, { releasedTags: [], after: MIGRATION_LINT_BASELINE })).toEqual(
      []
    );

    // 0016 drops two tables and a column with no header: without the baseline
    // it is exactly what the lint exists to stop.
    const unbaselined = lintMigrations(shipped, { releasedTags: [], after: -1 });
    const files = new Set(unbaselined.map((f) => f.file));
    expect(files.has('0016_resource_access.sql')).toBe(true);
    expect(files.has('0021_drop_notification_sentences.sql')).toBe(true);
    // 0024 drops a column default an older server relied on.
    expect(files.has('0024_artifact_status.sql')).toBe(true);
  });
});
