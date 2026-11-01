import * as artifactTables from './schema-artifacts.js';
import * as platformTables from './schema-platform.js';
import * as sharingTables from './schema-sharing.js';
import * as coreTables from './schema.js';

/**
 * Every server table, composed from the schema modules (schema*.ts): what
 * drizzle's client is given, and what code that walks all tables reads (the
 * migration coverage check, tests that address tables by name).
 */
export const serverSchema = {
  ...coreTables,
  ...artifactTables,
  ...sharingTables,
  ...platformTables,
};

export type ServerSchema = typeof serverSchema;
