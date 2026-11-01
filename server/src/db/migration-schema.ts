import type { Migration } from './migration-files.js';

/**
 * Replays the DDL in the migration set to reconstruct the table/column shape a
 * database ends up with after applying every file in order. This is what makes
 * the coverage guard column-level: comparing this against `schema.ts` catches a
 * column that reached the ORM but never reached a migration — the
 * `share_tokens.invited_email` failure mode, which a table-level check cannot
 * see (DEPLOYMENT.md §4).
 *
 * It reads the SQL rather than a live database on purpose: the guard has to run
 * in the same `pnpm test` as everything else, where there is no DATABASE_URL.
 *
 * Statements are matched wherever they appear, including inside a `DO $$ ... $$`
 * guard block, so a conditionally-applied ALTER still counts as coverage.
 */

/** table name → column names, all lowercased. */
export type TableColumns = Map<string, Set<string>>;

const CREATE_TABLE =
  /create\s+table\s+(?:if\s+not\s+exists\s+)?(?:"?\w+"?\s*\.\s*)?"?(\w+)"?\s*\(/gi;
const DROP_TABLE = /drop\s+table\s+(?:if\s+exists\s+)?(?:"?\w+"?\s*\.\s*)?"?(\w+)"?/gi;
const ALTER_TABLE =
  /alter\s+table\s+(?:only\s+)?(?:if\s+exists\s+)?(?:"?\w+"?\s*\.\s*)?"?(\w+)"?/gi;

const ADD_ACTION = /^add\s+(?:column\s+)?(?:if\s+not\s+exists\s+)?"?(\w+)"?/i;
const DROP_ACTION = /^drop\s+(?:column\s+)?(?:if\s+exists\s+)?"?(\w+)"?/i;
const RENAME_COLUMN = /^rename\s+column\s+"?(\w+)"?\s+to\s+"?(\w+)"?/i;
const RENAME_TABLE = /^rename\s+to\s+"?(\w+)"?/i;

const FIRST_IDENTIFIER = /^\s*"?([a-zA-Z_][\w$]*)"?/;

// What a table-level element or an ALTER action starts with when it is a
// constraint rather than a column. `ADD CONSTRAINT ...`, `PRIMARY KEY (...)`,
// `DROP CONSTRAINT ...` must not be mistaken for column names.
const CONSTRAINT_KEYWORDS = new Set([
  'constraint',
  'primary',
  'foreign',
  'unique',
  'check',
  'exclude',
  'like',
]);

/** A commented-out statement must not count as coverage, so comments go first. */
function stripSqlComments(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/**
 * Advances past the string/identifier literal starting at `start`, so a `(`,
 * `,` or `;` inside `'...'`, `"..."` or `$tag$...$tag$` never counts as
 * structure. Returns the index just past the literal, or -1 if `start` is not
 * the opening of one.
 */
function skipLiteral(sql: string, start: number): number {
  const char = sql[start];

  if (char === "'" || char === '"') {
    for (let index = start + 1; index < sql.length; index += 1) {
      if (sql[index] !== char) continue;
      // A doubled quote is an escaped quote, not the end of the literal.
      if (sql[index + 1] === char) {
        index += 1;
        continue;
      }
      return index + 1;
    }
    throw new Error(`[migration-schema] unterminated ${char} literal`);
  }

  if (char === '$') {
    const tag = /^\$\w*\$/.exec(sql.slice(start));
    if (!tag) return -1;
    const end = sql.indexOf(tag[0], start + tag[0].length);
    if (end === -1) throw new Error(`[migration-schema] unterminated ${tag[0]} literal`);
    return end + tag[0].length;
  }

  return -1;
}

/** Index of the `)` matching the `(` at `open`. */
function findMatchingParen(sql: string, open: number): number {
  let depth = 0;
  for (let index = open; index < sql.length; index += 1) {
    const skipped = skipLiteral(sql, index);
    if (skipped !== -1) {
      index = skipped - 1;
      continue;
    }
    if (sql[index] === '(') depth += 1;
    else if (sql[index] === ')') {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error('[migration-schema] unbalanced parentheses');
}

/** Index of the `;` ending the statement that starts at `from`. */
function findStatementEnd(sql: string, from: number): number {
  let depth = 0;
  for (let index = from; index < sql.length; index += 1) {
    const skipped = skipLiteral(sql, index);
    if (skipped !== -1) {
      index = skipped - 1;
      continue;
    }
    if (sql[index] === '(') depth += 1;
    else if (sql[index] === ')') depth -= 1;
    else if (sql[index] === ';' && depth === 0) return index;
  }
  return sql.length;
}

/** Splits on commas at the top nesting level only. */
function splitTopLevel(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const skipped = skipLiteral(text, index);
    if (skipped !== -1) {
      index = skipped - 1;
      continue;
    }
    if (text[index] === '(') depth += 1;
    else if (text[index] === ')') depth -= 1;
    else if (text[index] === ',' && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part.length > 0);
}

function readIdentifier(text: string): string | null {
  const match = FIRST_IDENTIFIER.exec(text);
  return match?.[1]?.toLowerCase() ?? null;
}

function parseColumnDefinitions(body: string): Set<string> {
  const columns = new Set<string>();
  for (const definition of splitTopLevel(body)) {
    const name = readIdentifier(definition);
    if (name && !CONSTRAINT_KEYWORDS.has(name)) columns.add(name);
  }
  return columns;
}

function applyAlterActions(
  columns: Set<string>,
  schema: TableColumns,
  table: string,
  body: string
) {
  for (const action of splitTopLevel(body)) {
    const renamedColumn = RENAME_COLUMN.exec(action);
    if (renamedColumn) {
      const [, from, to] = renamedColumn;
      if (from && to) {
        columns.delete(from.toLowerCase());
        columns.add(to.toLowerCase());
      }
      continue;
    }

    const renamedTable = RENAME_TABLE.exec(action);
    if (renamedTable?.[1]) {
      schema.delete(table);
      schema.set(renamedTable[1].toLowerCase(), columns);
      continue;
    }

    const added = ADD_ACTION.exec(action)?.[1]?.toLowerCase();
    if (added && !CONSTRAINT_KEYWORDS.has(added)) {
      columns.add(added);
      continue;
    }

    const dropped = DROP_ACTION.exec(action)?.[1]?.toLowerCase();
    if (dropped && !CONSTRAINT_KEYWORDS.has(dropped)) columns.delete(dropped);
  }
}

interface Statement {
  kind: 'create' | 'drop' | 'alter';
  table: string;
  at: number;
  end: number;
}

function collect(sql: string, pattern: RegExp, kind: Statement['kind']): Statement[] {
  const found: Statement[] = [];
  for (const match of sql.matchAll(pattern)) {
    const table = match[1]?.toLowerCase();
    if (table === undefined || match.index === undefined) continue;
    found.push({ kind, table, at: match.index, end: match.index + match[0].length });
  }
  return found;
}

function applyStatements(sql: string, schema: TableColumns): void {
  // Source order matters: a file that drops and recreates a table must not have
  // the drop applied after the create.
  const statements = [
    ...collect(sql, CREATE_TABLE, 'create'),
    ...collect(sql, DROP_TABLE, 'drop'),
    ...collect(sql, ALTER_TABLE, 'alter'),
  ].sort((a, b) => a.at - b.at);

  for (const statement of statements) {
    if (statement.kind === 'drop') {
      schema.delete(statement.table);
      continue;
    }

    if (statement.kind === 'create') {
      const open = statement.end - 1;
      const body = sql.slice(open + 1, findMatchingParen(sql, open));
      const existing = schema.get(statement.table);
      // `CREATE TABLE IF NOT EXISTS` against a table an earlier migration
      // already created is a no-op on a real database, so it must not
      // overwrite what that one declared.
      if (existing) {
        for (const column of parseColumnDefinitions(body)) existing.add(column);
      } else {
        schema.set(statement.table, parseColumnDefinitions(body));
      }
      continue;
    }

    const columns = schema.get(statement.table);
    // An ALTER against a table no migration creates is already reported by the
    // table-level assertion; ignoring it here keeps the failure to one report.
    if (!columns) continue;
    const body = sql.slice(statement.end, findStatementEnd(sql, statement.end));
    applyAlterActions(columns, schema, statement.table, body);
  }
}

/** Replays every migration in order into the schema each one leaves behind. */
export function buildSchemaFromMigrations(migrations: Migration[]): TableColumns {
  const schema: TableColumns = new Map();
  for (const migration of migrations) {
    applyStatements(stripSqlComments(migration.sql), schema);
  }
  return schema;
}
