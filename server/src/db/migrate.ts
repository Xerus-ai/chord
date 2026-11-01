import 'dotenv/config';
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Client, neonConfig } from '@neondatabase/serverless';
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
 *   pnpm run migrate              apply everything pending
 *   pnpm run migrate --status     report applied/pending, touch nothing
 *   pnpm run migrate --baseline 0010
 *                                 adopt a database that was migrated by hand:
 *                                 record 0000..0010 as applied WITHOUT running
 *                                 them
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

async function main(argv: string[]): Promise<void> {
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
