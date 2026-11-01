import { neon } from '@neondatabase/serverless';
import { drizzle, type NeonHttpDatabase } from 'drizzle-orm/neon-http';
import { serverSchema, type ServerSchema } from './server-schema.js';

const connectionString = process.env.DATABASE_URL;

/**
 * Boot-time guard: running without a database means running without the
 * tables authorization is checked against. That is only acceptable under the
 * same explicit DEV_MODE opt-in that disables auth itself (see
 * middleware/auth.ts) — a production server missing DATABASE_URL must refuse
 * to boot rather than start with access control silently disabled. Exported
 * as a pure function so the production behavior is unit-testable; the test
 * exemption exists because unit tests transitively import this module with
 * no database configured.
 */
export function assertDatabaseConfigured(env: {
  hasConnectionString: boolean;
  isProduction: boolean;
  explicitDevMode: boolean;
  isTestRun: boolean;
}): void {
  if (env.hasConnectionString || env.isTestRun) return;
  if (!env.isProduction && env.explicitDevMode) return;
  throw new Error(
    env.isProduction
      ? '[db] DATABASE_URL is required when NODE_ENV=production. Refusing to start with authorization checks disabled.'
      : '[db] DATABASE_URL is not set. Set DATABASE_URL for a real database, or set DEV_MODE=true for local development.'
  );
}

assertDatabaseConfigured({
  hasConnectionString: !!connectionString,
  isProduction: process.env.NODE_ENV === 'production',
  explicitDevMode: process.env.DEV_MODE === 'true',
  isTestRun: process.env.NODE_ENV === 'test' || process.env.VITEST !== undefined,
});

export const hasDb = !!connectionString;

let _db: NeonHttpDatabase<ServerSchema> | null = null;

if (connectionString) {
  const sql = neon(connectionString);
  _db = drizzle(sql, { schema: serverSchema });
} else {
  console.warn(
    '[db] DATABASE_URL not set — running without database (Hocuspocus file persistence only)'
  );
}

export const db = _db as NeonHttpDatabase<ServerSchema>;

export type Database = typeof db;
