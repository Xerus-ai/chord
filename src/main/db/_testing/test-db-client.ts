import { createMigratedTestDb } from './migrated-test-db';

/**
 * `@main/db/client` for a main-process suite, backed by a real SQLite database
 * built from the shipped migrations (`createMigratedTestDb`):
 *
 *   vi.mock('@main/db/client', () => import('@main/db/_testing/test-db-client'));
 *
 * vitest evaluates it once per test file, so each file gets its own database.
 */
export const db = createMigratedTestDb();
