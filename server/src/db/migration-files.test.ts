import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { loadMigrations, planMigrations, type Migration } from './migration-files.js';

/**
 * `planMigrations` is what stands between a deploy and a half-migrated
 * database. Every branch it has is a refusal, so each one is asserted here.
 */

const tempDirs: string[] = [];

function migrationsDir(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'chord-migrations-'));
  tempDirs.push(dir);
  for (const [name, sql] of Object.entries(files)) writeFileSync(join(dir, name), sql);
  return dir;
}

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
});

function applied(migrations: Migration[], ...names: string[]) {
  return migrations
    .filter((migration) => names.includes(migration.name))
    .map((migration) => ({ name: migration.name, checksum: migration.checksum }));
}

describe('loadMigrations', () => {
  it('orders by numeric prefix, not by string sort', () => {
    const dir = migrationsDir({
      '0010_ten.sql': 'select 1;',
      '0002_two.sql': 'select 1;',
      '0000_zero.sql': 'select 1;',
    });

    expect(loadMigrations(dir).map((migration) => migration.version)).toEqual([0, 2, 10]);
  });

  it('rejects a misnamed .sql file rather than silently skipping it', () => {
    const dir = migrationsDir({ '0000_ok.sql': 'select 1;', 'fixup.sql': 'select 1;' });

    expect(() => loadMigrations(dir)).toThrow(/must be named <NNNN>_<slug>\.sql: fixup\.sql/);
  });

  it('rejects a duplicated migration number', () => {
    const dir = migrationsDir({ '0001_a.sql': 'select 1;', '0001_b.sql': 'select 1;' });

    expect(() => loadMigrations(dir)).toThrow(/duplicate migration number 1/);
  });

  it('rejects a missing migrations directory', () => {
    expect(() => loadMigrations(join(tmpdir(), 'chord-migrations-does-not-exist'))).toThrow(
      /migrations directory not found/
    );
  });

  it('checksums the real migration set independently of line endings', () => {
    const lf = migrationsDir({ '0000_a.sql': 'create table a (id text);\n' });
    const crlf = migrationsDir({ '0000_a.sql': 'create table a (id text);\r\n' });

    expect(loadMigrations(lf)[0]?.checksum).toBe(loadMigrations(crlf)[0]?.checksum);
  });
});

describe('planMigrations', () => {
  const dir = () =>
    migrationsDir({
      '0000_a.sql': 'select 1;',
      '0001_b.sql': 'select 2;',
      '0002_c.sql': 'select 3;',
    });

  it('returns everything for a fresh database', () => {
    const migrations = loadMigrations(dir());

    expect(planMigrations(migrations, []).map((one) => one.name)).toEqual([
      '0000_a.sql',
      '0001_b.sql',
      '0002_c.sql',
    ]);
  });

  it('returns only the unapplied tail', () => {
    const migrations = loadMigrations(dir());

    expect(
      planMigrations(migrations, applied(migrations, '0000_a.sql', '0001_b.sql')).map(
        (one) => one.name
      )
    ).toEqual(['0002_c.sql']);
  });

  it('refuses when an applied migration changed after the fact', () => {
    const migrations = loadMigrations(dir());
    const record = applied(migrations, '0001_b.sql').map((one) => ({ ...one, checksum: 'stale' }));

    expect(() => planMigrations(migrations, record)).toThrow(/0001_b\.sql changed after/);
  });

  it('refuses when the database has applied a migration the checkout does not have', () => {
    const migrations = loadMigrations(dir());

    expect(() =>
      planMigrations(migrations, [{ name: '0003_from_the_future.sql', checksum: 'x' }])
    ).toThrow(/ahead of this checkout/);
  });

  it('refuses a pending migration numbered below an applied one', () => {
    const migrations = loadMigrations(dir());

    expect(() => planMigrations(migrations, applied(migrations, '0002_c.sql'))).toThrow(
      /numbered below the highest applied one \(2\): 0000_a\.sql, 0001_b\.sql/
    );
  });
});

describe('the deployable migration set', () => {
  it('loads, so its names and numbering are valid', () => {
    const migrations = loadMigrations();

    expect(migrations.length).toBeGreaterThan(0);
    expect(migrations[0]?.name).toBe('0000_baseline.sql');
  });
});
