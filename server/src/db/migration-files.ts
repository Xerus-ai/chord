import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The deployable migration set — hand-written SQL applied in numeric order.
 * `server/drizzle/` is drizzle-kit's snapshot chain and is NOT on the deploy
 * path (see its README). Everything that reads migrations — the runner
 * (`migrate.ts`) and the coverage guard (`migration-coverage.test.ts`) —
 * resolves the set through this module so the two can never disagree about
 * what "the migration set" is.
 */
const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

const MIGRATION_FILENAME = /^(\d{4})_[a-z0-9_]+\.sql$/;

export interface Migration {
  /** File name, e.g. `0007_command_channel.sql`. The ledger's primary key. */
  name: string;
  /** Numeric prefix. The prefix IS the apply order. */
  version: number;
  sql: string;
  checksum: string;
}

export interface AppliedMigration {
  name: string;
  checksum: string;
}

/**
 * Hashed with `\r` stripped: a Windows checkout gets CRLF line endings and a
 * Linux one gets LF for the same committed bytes, and a checksum that flips
 * between the two would report drift on every cross-platform run against a
 * shared database.
 */
function computeChecksum(sql: string): string {
  return createHash('sha256').update(sql.replace(/\r/g, ''), 'utf8').digest('hex');
}

export function loadMigrations(dir: string = MIGRATIONS_DIR): Migration[] {
  if (!existsSync(dir)) {
    throw new Error(`[migrate] migrations directory not found: ${dir}`);
  }

  const files = readdirSync(dir).filter((file) => file.endsWith('.sql'));

  // A misnamed file is never applied by anything that orders on the numeric
  // prefix, so it would silently do nothing. Refuse the whole set instead.
  const misnamed = files.filter((file) => !MIGRATION_FILENAME.test(file)).sort();
  if (misnamed.length > 0) {
    throw new Error(`[migrate] migrations must be named <NNNN>_<slug>.sql: ${misnamed.join(', ')}`);
  }

  const migrations = files
    .map((name) => {
      const sql = readFileSync(join(dir, name), 'utf8');
      return {
        name,
        version: Number(MIGRATION_FILENAME.exec(name)?.[1]),
        sql,
        checksum: computeChecksum(sql),
      };
    })
    .sort((a, b) => a.version - b.version);

  // A duplicate prefix makes the apply order ambiguous.
  const seen = new Map<number, string>();
  for (const migration of migrations) {
    const previous = seen.get(migration.version);
    if (previous) {
      throw new Error(
        `[migrate] duplicate migration number ${migration.version}: ${previous}, ${migration.name}`
      );
    }
    seen.set(migration.version, migration.name);
  }

  return migrations;
}

/**
 * Decides what still has to run, and refuses to run anything at all when the
 * ledger and the repo disagree. Pure so the decision is testable without a
 * database; every branch here is a stop, never a repair.
 */
export function planMigrations(all: Migration[], applied: AppliedMigration[]): Migration[] {
  const byName = new Map(all.map((migration) => [migration.name, migration]));

  for (const record of applied) {
    const migration = byName.get(record.name);
    if (!migration) {
      throw new Error(
        `[migrate] database has applied ${record.name}, which no longer exists in the migration set — the deployed database is ahead of this checkout`
      );
    }
    if (migration.checksum !== record.checksum) {
      throw new Error(
        `[migrate] ${record.name} changed after it was applied (checksum mismatch) — migrations are immutable; write a new one instead`
      );
    }
  }

  const appliedNames = new Set(applied.map((record) => record.name));
  const pending = all.filter((migration) => !appliedNames.has(migration.name));

  // Pending must be a contiguous tail. A pending migration numbered below an
  // applied one would run against a schema that has already moved past it.
  const highestApplied = all
    .filter((migration) => appliedNames.has(migration.name))
    .reduce((max, migration) => Math.max(max, migration.version), -1);
  const outOfOrder = pending.filter((migration) => migration.version < highestApplied);
  if (outOfOrder.length > 0) {
    throw new Error(
      `[migrate] pending migrations numbered below the highest applied one (${highestApplied}): ${outOfOrder
        .map((migration) => migration.name)
        .join(', ')}`
    );
  }

  return pending;
}
