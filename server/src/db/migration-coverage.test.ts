import { getTableColumns, getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { loadMigrations } from './migration-files.js';
import { buildSchemaFromMigrations } from './migration-schema.js';
import { serverSchema } from './server-schema.js';

// Guards the failure mode that shipped `agent_plan_requests` to production
// missing: a pgTable landed in a schema module (schema*.ts), every route that queries it typechecked
// and passed review, and nothing anywhere noticed that no migration ever created
// it on a deployed database. `server/src/db/migrations/` is the deployable set
// (hand-written SQL, applied by `pnpm run migrate` — DEPLOYMENT.md §4);
// `server/drizzle/` is drizzle-kit's own snapshot chain and is explicitly NOT on
// the deploy path, so a table appearing only there is still missing in production.
//
// The rule is absolute — every table AND every column in the schema modules is created by
// a file in the deployable set. It carries no exception list: 0000_baseline.sql
// now creates the 18 tables that predated the set, which is what made an
// exception list necessary in the first place. Do not reintroduce one.
//
// Coverage is column-level: migration-schema.ts replays the set's DDL, so a
// column added to a schema module with no matching ALTER TABLE fails here by name.
// That closes the gap `share_tokens.invited_email` shipped through — the column
// existed in schema.ts and in server/drizzle/, every query referencing it
// typechecked, and sign-in broke on every database built from the runbook.

interface SchemaTable {
  name: string;
  columns: string[];
}

function collectSchemaTables(): SchemaTable[] {
  const tables: SchemaTable[] = [];
  for (const value of Object.values(serverSchema)) {
    if (!is(value, PgTable)) continue;
    tables.push({
      name: getTableName(value),
      columns: Object.values(getTableColumns(value))
        .map((column) => column.name)
        .sort(),
    });
  }
  return tables.sort((a, b) => a.name.localeCompare(b.name));
}

const migrations = loadMigrations();
const migratedSchema = buildSchemaFromMigrations(migrations);

describe('migration coverage', () => {
  it('creates every table declared in schema.ts', () => {
    const tables = collectSchemaTables();
    // A broken schema import would otherwise make every assertion below vacuous.
    expect(tables.length).toBeGreaterThan(0);

    const uncovered = tables
      .filter((table) => !migratedSchema.has(table.name))
      .map((table) => table.name);

    expect(
      uncovered,
      `no CREATE TABLE in server/src/db/migrations/ for: ${uncovered.join(', ')}`
    ).toEqual([]);
  });

  it('creates every column declared in schema.ts', () => {
    const missing: string[] = [];

    for (const table of collectSchemaTables()) {
      const migrated = migratedSchema.get(table.name);
      // Absent tables are reported by the assertion above; reporting each of
      // their columns here too would bury it.
      if (!migrated) continue;
      for (const column of table.columns) {
        if (!migrated.has(column)) missing.push(`${table.name}.${column}`);
      }
    }

    expect(
      missing,
      `no CREATE TABLE or ALTER TABLE ... ADD COLUMN in server/src/db/migrations/ for: ${missing.join(', ')}`
    ).toEqual([]);
  });

  it('parses a column list for every table it creates', () => {
    // A parser that silently produced empty column sets would make the
    // column-level assertion above pass for anything.
    const empty = [...migratedSchema.entries()]
      .filter(([, columns]) => columns.size === 0)
      .map(([table]) => table);

    expect(empty, `parsed no columns for: ${empty.join(', ')}`).toEqual([]);
  });
});

describe('migration set hygiene', () => {
  it('numbers migrations uniquely and contiguously', () => {
    // loadMigrations itself throws on a misnamed or duplicated file.
    const numbers = migrations.map((migration) => migration.version);

    expect(numbers.length).toBeGreaterThan(0);

    // 0000 is the fresh-database baseline and is optional, so the run may start
    // at either 0 or 1 — but nowhere else.
    const first = numbers[0];
    expect(first, `first migration must be 0000 or 0001, got ${first}`).toBeLessThanOrEqual(1);

    // The numeric prefix IS the apply order, so a gap means a file that some
    // database has applied is no longer in the repo.
    expect(numbers).toEqual(numbers.map((_, index) => (first ?? 0) + index));
  });
});
