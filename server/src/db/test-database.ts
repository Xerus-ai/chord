import { PGlite, type Results } from '@electric-sql/pglite';
import { neonConfig } from '@neondatabase/serverless';
import { loadMigrations, planMigrations } from './migration-files.js';

/**
 * TEST-ONLY database for real-DB route tests, with zero external services.
 *
 * When TEST_DATABASE_URL is set the tests use that real Postgres unchanged.
 * Otherwise they run against PGlite — real Postgres compiled to WASM,
 * in-process — with every file in `src/db/migrations/` applied in order.
 *
 * The seam is the transport, not the driver: `neonConfig.fetchFunction` is
 * pointed at an adapter that speaks Neon's HTTP SQL wire format and executes
 * against PGlite. `client.ts`, drizzle's neon-http session and `db.batch()`
 * therefore run exactly as in production; only the bytes after `fetch()`
 * differ. Swapping in drizzle's PGlite driver instead would lose `db.batch()`,
 * which the routes rely on for their atomic writes.
 */

/** Parses as a Neon connection string (neon() validates it) but is never dialed. */
export const PGLITE_DATABASE_URL = 'postgresql://pglite:pglite@pglite.invalid/chord_test';

export interface TestDatabase {
  /** Value to stub into DATABASE_URL before importing `db/client.js`. */
  url: string;
  /** Resolves once the database is migrated and routed; call in beforeAll. */
  start(): Promise<void>;
  /** Releases the in-process database and restores the fetch transport. */
  stop(): Promise<void>;
}

interface NeonQuery {
  query: string;
  params: unknown[];
}

type Queryable = Pick<PGlite, 'query'>;
type TextParsers = Record<number, (value: string) => string>;

/** Same DDL as migrate.ts's ledger, so a PGlite database looks like a migrated one. */
const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    name text PRIMARY KEY,
    checksum text NOT NULL,
    applied_at timestamptz NOT NULL DEFAULT now()
  )
`;

// Neon returns these keys on a failed query; the client copies them onto
// NeonDbError, which is what callers branch on (e.g. `code === '23505'`).
const ERROR_FIELDS = [
  'severity',
  'code',
  'detail',
  'hint',
  'position',
  'internalPosition',
  'internalQuery',
  'where',
  'schema',
  'table',
  'column',
  'dataType',
  'constraint',
  'file',
  'line',
  'routine',
] as const;

async function migrate(pg: PGlite): Promise<void> {
  await pg.exec(LEDGER_DDL);
  for (const migration of planMigrations(loadMigrations(), [])) {
    await pg.transaction(async (tx) => {
      await tx.exec(migration.sql);
      await tx.query('INSERT INTO _migrations (name, checksum) VALUES ($1, $2)', [
        migration.name,
        migration.checksum,
      ]);
    });
  }
}

/**
 * Neon's client sends `Neon-Raw-Text-Output: true` and applies pg-types
 * parsers to text values itself; PGlite would otherwise hand back JS values
 * (a boolean `true` would then parse as false, a Date would break drizzle's
 * timestamp mapping). An identity parser for every type in the catalog —
 * read after migrations, so enum types are included — keeps Postgres' text.
 */
async function textParsers(pg: PGlite): Promise<TextParsers> {
  const { rows } = await pg.query<[number]>('SELECT oid FROM pg_type', [], { rowMode: 'array' });
  return Object.fromEntries(rows.map(([oid]) => [oid, (value: string) => value]));
}

async function runQuery(db: Queryable, parsers: TextParsers, { query, params }: NeonQuery) {
  const result: Results<unknown[]> = await db.query(query, params, { rowMode: 'array', parsers });
  return {
    command: result.command ?? '',
    fields: result.fields,
    rows: result.rows,
    rowCount: result.rowCount ?? result.affectedRows ?? 0,
    rowAsArray: true,
  };
}

function errorResponse(error: unknown): Response {
  if (!(error instanceof Error)) throw error;
  const source = error as Error & Record<string, unknown>;
  // Only Postgres errors carry a SQLSTATE; anything else is a bug in the test
  // harness and must surface as itself, not as a database error.
  if (typeof source.code !== 'string') throw error;
  const body: Record<string, unknown> = { message: error.message };
  for (const field of ERROR_FIELDS) body[field] = source[field];
  return new Response(JSON.stringify(body), { status: 400 });
}

function neonHttpOverPglite(pg: PGlite, parsers: TextParsers): typeof fetch {
  return async (_input, init) => {
    const body = JSON.parse(String(init?.body)) as NeonQuery | { queries: NeonQuery[] };
    try {
      if ('queries' in body) {
        // Neon runs an HTTP batch as one transaction; so does this.
        const results = await pg.transaction(async (tx) => {
          const out = [];
          for (const one of body.queries) out.push(await runQuery(tx, parsers, one));
          return out;
        });
        return new Response(JSON.stringify({ results }), { status: 200 });
      }
      return new Response(JSON.stringify(await runQuery(pg, parsers, body)), { status: 200 });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export function createTestDatabase(): TestDatabase {
  const override = process.env.TEST_DATABASE_URL;
  if (override) {
    return { url: override, start: async () => {}, stop: async () => {} };
  }

  let pg: PGlite | null = null;
  const previousFetch = neonConfig.fetchFunction;

  return {
    url: PGLITE_DATABASE_URL,
    async start() {
      pg = await PGlite.create();
      // Neon's text output is UTC; match it so timestamps round-trip identically.
      await pg.exec("SET TIME ZONE 'UTC'");
      await migrate(pg);
      neonConfig.fetchFunction = neonHttpOverPglite(pg, await textParsers(pg));
    },
    async stop() {
      neonConfig.fetchFunction = previousFetch;
      await pg?.close();
      pg = null;
    },
  };
}
