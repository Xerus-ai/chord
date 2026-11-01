import { sql, type Column, type SQL } from 'drizzle-orm';

const LIKE_ESCAPE_CHARACTER = '\\';

/**
 * A `LIKE` pattern matching `query` as a literal substring.
 *
 * SQLite's `LIKE` has no escape character at all unless the statement declares
 * one, so escaping `%` and `_` without the `ESCAPE` clause makes things worse
 * rather than better: the backslashes stay in the pattern as literal characters
 * and a search for `foo_bar` then matches nothing. The clause is what gives
 * them their meaning, which is why the escaping and the clause are emitted
 * together here instead of being left to each call site.
 */
export function likeContains(column: Column, query: string): SQL {
  const escaped = query.replace(/[\\%_]/g, `${LIKE_ESCAPE_CHARACTER}$&`);
  return sql`${column} like ${`%${escaped}%`} escape ${LIKE_ESCAPE_CHARACTER}`;
}
