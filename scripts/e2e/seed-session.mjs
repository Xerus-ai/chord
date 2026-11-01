/**
 * Hands a seeded run's sign-in back to its seed profile.
 *
 * A run signs in with a copy of the seed's session. When the copy's access
 * token has expired, the app refreshes it (`chord-account-service.ts`), and
 * WorkOS refresh tokens are single-use: the copy now holds the only live
 * refresh token and the seed's is spent. Unreturned, the seed's next launch
 * reads "no live session" — on 2026-10-06 two seeds went that way within one
 * run each. So when a run's app has closed, the copy's account rows (the
 * refresh token and profile in `kv`, the session token in `app_secrets`,
 * encrypted with the key in `Local State`, which the copy shares with the
 * seed) are written over the seed's, if the copy refreshed.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SESSION_SECRET_KEY = 'chord-account-token';

function readAccountRows(dbPath) {
  const db = new DatabaseSync(dbPath);
  try {
    return {
      kv: db.prepare("SELECT key, value, updated_at FROM kv WHERE key LIKE 'account:%'").all(),
      secret: db
        .prepare('SELECT key, secret FROM app_secrets WHERE key = ?')
        .get(SESSION_SECRET_KEY),
    };
  } finally {
    db.close();
  }
}

function refreshTokenOf(rows) {
  const row = rows.kv.find((r) => r.key === 'account:refreshToken');
  return row ? JSON.parse(row.value) : null;
}

/** Returns true when the seed was given the run's newer session. */
export function returnSessionToSeed(profileDir, seedDir) {
  const copyDb = join(profileDir, 'chord.db');
  const seedDb = join(seedDir, 'chord.db');
  if (!existsSync(copyDb)) throw new Error(`The run's profile has no database: ${copyDb}`);
  const copy = readAccountRows(copyDb);
  const seed = readAccountRows(seedDb);
  const token = refreshTokenOf(copy);
  // Nothing refreshed, or the copy was signed out (an empty token): the seed keeps its own.
  if (!token || token === refreshTokenOf(seed)) return false;

  const db = new DatabaseSync(seedDb);
  try {
    db.exec('BEGIN');
    const putKv = db.prepare(
      'INSERT INTO kv (key, value, updated_at) VALUES (?, ?, ?) ' +
        'ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at'
    );
    for (const row of copy.kv) putKv.run(row.key, row.value, row.updated_at);
    if (copy.secret) {
      db.prepare(
        'INSERT INTO app_secrets (key, secret) VALUES (?, ?) ' +
          'ON CONFLICT(key) DO UPDATE SET secret = excluded.secret'
      ).run(copy.secret.key, copy.secret.secret);
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  } finally {
    db.close();
  }
  return true;
}
