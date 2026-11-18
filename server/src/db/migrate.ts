import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, neonConfig } from '@neondatabase/serverless';
import { config as loadDotenv } from 'dotenv';
import ws from 'ws';
import {
  loadMigrations,
  planMigrations,
  type AppliedMigration,
  type Migration,
} from './migration-files.js';

/**
 * Applies `src/db/migrations/` to a database, in order, each file in its own
 * transaction, recording what it applied in the `_migrations` ledger.
 *
 * This replaces the hand-run `psql` loop that DEPLOYMENT.md §4 used to be: that
 * loop had no memory, so "which files does this database already have?" was
 * answered from a human's recollection, and getting it wrong is how a database
 * ends up mid-set (the `share_tokens.invited_email` outage).
 *
 * It uses the WebSocket driver (`Client`), not the app's `neon()` HTTP driver:
 * over HTTP every statement is its own implicit transaction, so a file that
 * fails halfway leaves its earlier statements committed. Migrations need a real
 * session with BEGIN/COMMIT, which is what this driver gives.
 *
 *   pnpm run migrate --status     report applied/pending, touch nothing
 *   CHORD_RELEASE_TAG=<tag> pnpm run migrate
 *                                 apply everything pending (deploy.sh runs this)
 *   pnpm run migrate --unreleased the same, on a disposable or local database
 *   CHORD_RELEASE_TAG=<tag> pnpm run migrate --baseline 0010
 *                                 adopt a database that was migrated by hand:
 *                                 record 0000..0010 as applied WITHOUT running
 *                                 them
 *
 * A write (apply or --baseline) is refused without one of those two: dev and
 * prod share one database. The tag is read from the process environment only,
 * never from .env.
 */

neonConfig.webSocketConstructor = ws;

// Serializes concurrent runners (two deploys, a deploy racing a developer)
// against one database. Session-scoped, so it is held for exactly this run.
const ADVISORY_LOCK_KEY = 4919170251;

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

export interface MigrateOptions {
  connectionString: string;
  /** Numeric prefix, e.g. `10`. Records 0000..N as applied without running. */
  baselineThrough?: number;
  /** Report only; no ledger writes, no migrations applied. */
  statusOnly?: boolean;
}

export interface MigrateResult {
  applied: string[];
  baselined: string[];
  pending: string[];
}

async function readLedger(client: Client): Promise<AppliedMigration[]> {
  const { rows } = await client.query<AppliedMigration>(
    'SELECT name, checksum FROM _migrations ORDER BY name'
  );
  return rows;
}

/**
 * A database that predates this runner has an empty ledger and a full schema.
 * Applying 0000 onward to it would fail on the first unguarded statement — and
 * worse, some of those files carry data migrations (0003 renumbers artifact
 * versions). Refuse, and point at `--baseline`.
 */
async function assertLedgerMatchesDatabase(client: Client, applied: number): Promise<void> {
  if (applied > 0) return;
  const { rows } = await client.query<{ exists: boolean }>(
    "SELECT to_regclass('public.users') IS NOT NULL AS exists"
  );
  if (!rows[0]?.exists) return;
  throw new Error(
    '[migrate] this database already has application tables but no _migrations ledger — it was migrated by hand. Re-run with `--baseline <NNNN>` naming the last migration it received, to record those as applied without re-running them.'
  );
}

async function applyMigration(client: Client, migration: Migration): Promise<void> {
  await client.query('BEGIN');
  try {
    // Simple-query protocol: the whole file runs as one multi-statement query
    // inside the transaction opened above, with no client-side splitting to get
    // wrong on dollar-quoted bodies.
    await client.query(migration.sql);
    await client.query('INSERT INTO _migrations (name, checksum) VALUES ($1, $2)', [
      migration.name,
      migration.checksum,
    ]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw new Error(`[migrate] ${migration.name} failed and was rolled back`, { cause: error });
  }
}

async function baseline(
  client: Client,
  pending: Migration[],
  through: number
): Promise<Migration[]> {
  const adopted = pending.filter((migration) => migration.version <= through);
  if (adopted.length === 0) {
    throw new Error(
      `[migrate] --baseline ${through} matches no unrecorded migration; nothing to adopt`
    );
  }
  await client.query('BEGIN');
  try {
    for (const migration of adopted) {
      await client.query('INSERT INTO _migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        migration.checksum,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return adopted;
}

export async function runMigrations(options: MigrateOptions): Promise<MigrateResult> {
  const migrations = loadMigrations();
  const client = new Client(options.connectionString);
  await client.connect();

  try {
    await client.query('SELECT pg_advisory_lock($1)', [ADVISORY_LOCK_KEY]);
    await client.query(LEDGER_DDL);

    const applied = await readLedger(client);
    // Only the normal apply path must refuse a pre-runner database (empty
    // ledger + existing tables): running 0000.. onto it would fail on the first
    // unguarded statement or re-run a data migration. `--status` only reports
    // and `--baseline` is the sanctioned way to adopt exactly such a database,
    // so neither may be blocked here — the guard's own message tells the user to
    // run `--baseline`, which was previously unreachable because this assertion
    // fired ahead of the baseline branch below.
    if (!options.statusOnly && options.baselineThrough === undefined) {
      await assertLedgerMatchesDatabase(client, applied.length);
    }

    const pending = planMigrations(migrations, applied);

    if (options.statusOnly) {
      return { applied: [], baselined: [], pending: pending.map((one) => one.name) };
    }

    if (options.baselineThrough !== undefined) {
      const adopted = await baseline(client, pending, options.baselineThrough);
      const names = new Set(adopted.map((one) => one.name));
      return {
        applied: [],
        baselined: adopted.map((one) => one.name),
        pending: pending.filter((one) => !names.has(one.name)).map((one) => one.name),
      };
    }

    for (const migration of pending) {
      console.log(`[migrate] applying ${migration.name}`);
      await applyMigration(client, migration);
    }

    return { applied: pending.map((one) => one.name), baselined: [], pending: [] };
  } finally {
    await client.end();
  }
}

function parseBaselineArg(value: string | undefined): number {
  if (value === undefined) {
    throw new Error('[migrate] --baseline requires a migration number, e.g. --baseline 0010');
  }
  const version = Number(value.replace(/_.*$/, ''));
  if (!Number.isInteger(version) || version < 0) {
    throw new Error(`[migrate] --baseline expects a migration number, got: ${value}`);
  }
  return version;
}

/**
 * Dev and prod share one database, so a write from a feature branch would put
 * its unreleased migration files in production, past the release's migration
 * lint, and every later deploy would then refuse the database. A write (apply or
 * --baseline) needs the release tag deploy.sh passes, or an explicit
 * --unreleased for a database that is not the shared one. --status writes
 * nothing and is always allowed.
 */
function assertMayWrite(argv: string[], releaseTag: string): void {
  if (argv.includes('--status') || argv.includes('--unreleased') || releaseTag !== '') return;
  throw new Error(
    '[migrate] refusing to write: dev and prod share one database, and only a release deploy (deploy.sh sets CHORD_RELEASE_TAG) applies migrations to it. Use --status to read, or pass --unreleased if DATABASE_URL is a disposable or local database.'
  );
}

async function main(argv: string[]): Promise<void> {
  // Read before .env is loaded: the tag must come from the deploy that runs
  // this, never from a .env line that would switch the guard off for good.
  const releaseTag = (process.env.CHORD_RELEASE_TAG ?? '').trim();
  assertMayWrite(argv, releaseTag);
  loadDotenv();

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('[migrate] DATABASE_URL is not set');
  }

  const baselineIndex = argv.indexOf('--baseline');
  const options: MigrateOptions = {
    connectionString,
    statusOnly: argv.includes('--status'),
    ...(baselineIndex === -1 ? {} : { baselineThrough: parseBaselineArg(argv[baselineIndex + 1]) }),
  };
  if (!options.statusOnly && releaseTag) console.log(`[migrate] release ${releaseTag}`);

  const result = await runMigrations(options);

  for (const name of result.baselined) console.log(`[migrate] recorded (not run): ${name}`);
  for (const name of result.pending) console.log(`[migrate] pending: ${name}`);
  console.log(
    `[migrate] done — applied ${result.applied.length}, recorded ${result.baselined.length}, pending ${result.pending.length}`
  );
}

// `tsx src/db/migrate.ts` runs this; importing the module does not.
const invokedPath = process.argv[1];
if (invokedPath && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))) {
  await main(process.argv.slice(2));
}
