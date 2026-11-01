import type BetterSqlite3 from 'better-sqlite3';

/**
 * Foreign key enforcement is per-connection and OFF by default in SQLite, so
 * every `onDelete` in the schema is inert until a connection asks for it.
 *
 * `PRAGMA foreign_keys` is a documented no-op inside a transaction — SQLite
 * ignores it and reports no error — so a caller that flips it at the wrong
 * moment silently gets the opposite of what it asked for. Both callers here
 * depend on the value actually changing (db/initialize.ts turns enforcement
 * off so migration table-rebuilds cannot cascade), so the value is read back
 * and a mismatch throws rather than running the next statement under the
 * wrong regime.
 */
export function setForeignKeysEnforcement(
  connection: BetterSqlite3.Database,
  enabled: boolean
): void {
  connection.pragma(`foreign_keys = ${enabled ? 'ON' : 'OFF'}`);

  const rows = connection.pragma('foreign_keys') as { foreign_keys: number }[];
  const active = rows[0]?.foreign_keys === 1;
  if (active !== enabled) {
    throw new Error(
      `Could not ${enabled ? 'enable' : 'disable'} SQLite foreign key enforcement ` +
        '(PRAGMA foreign_keys is ignored inside a transaction)'
    );
  }
}
