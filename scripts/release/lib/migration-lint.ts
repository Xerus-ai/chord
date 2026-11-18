/**
 * Release preflight's migration lint (design C5, F8; devstation-5s42).
 *
 * A deploy migrates while the previous release is still serving, and flips
 * back to it when the new one is unhealthy (server/deploy/deploy.sh). So every
 * migration must leave a schema the previous release still works against:
 * expand/contract. A file that drops a table or column, renames a column,
 * changes a column's type, or adds a NOT NULL column without a DEFAULT is the
 * contract half, and ships only with a header naming the released tag that
 * already stopped using what it removes:
 *
 *   -- contract-for: v1.4.0
 */

export interface MigrationFile {
  name: string;
  sql: string;
}

export interface LintFinding {
  file: string;
  statement: string;
  reason: string;
}

/**
 * The migrations that shipped before the lint existed (0016 and 0021 drop
 * tables and columns with no header). Until a release tag exists, files
 * numbered at or below this are not linted; after that, preflight passes the
 * previous tag and only files added since it are.
 */
export const MIGRATION_LINT_BASELINE = 24;

const HEADER = /^--\s*contract-for:\s*(v\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)\s*$/;

/** The tag a file's header names: only the leading comment lines count. */
export function contractFor(sql: string): string | null {
  for (const raw of sql.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') continue;
    if (!line.startsWith('--')) return null;
    const m = HEADER.exec(line);
    if (m) return m[1];
  }
  return null;
}

/**
 * The SQL with comments, string literals and quoted identifiers blanked, so a
 * DROP TABLE inside a comment or a literal is not a statement and a `;` inside
 * a quoted name does not split one. Dollar-quoted bodies (DO $$ blocks) are
 * kept as SQL: DDL inside them still runs, and destructiveStatement finds it
 * anywhere in a statement, not only at its start.
 */
function stripCommentsAndStrings(sql: string): string {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (c === '-' && next === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
    } else if (c === '/' && next === '*') {
      const end = sql.indexOf('*/', i + 2);
      i = end === -1 ? sql.length : end + 2;
      out += ' ';
    } else if (c === "'" || c === '"') {
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      i++;
      out += c === "'" ? "''" : '"q"';
    } else if (c === '$') {
      const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i));
      if (tag) {
        out += ' ';
        i += tag[0].length;
      } else {
        out += c;
        i++;
      }
    } else {
      out += c;
      i++;
    }
  }
  return out;
}

/** Splits on commas outside parentheses (the actions of one ALTER TABLE). */
function splitActions(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '(') depth++;
    else if (text[i] === ')') depth--;
    else if (text[i] === ',' && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** An ALTER TABLE anywhere in a statement (inside a DO block too); group 1 is its actions. */
const ALTER_TABLE = /\bALTER\s+TABLE\s+(?:IF\s+EXISTS\s+)?(?:ONLY\s+)?(?:"q"|\S+)\s+([\s\S]*)$/i;
const DROP_OBJECT =
  /\bDROP\s+(TABLE|VIEW|MATERIALIZED\s+VIEW|FUNCTION|PROCEDURE|TRIGGER|TYPE|SEQUENCE|SCHEMA)\b/i;
/** A column name after ALTER [COLUMN]: `ALTER COLUMN type ...` names a column called type. */
const COLUMN = String.raw`(?:COLUMN\s+(?:"Q"|\S+)|(?!COLUMN\b)(?:"Q"|\S+))`;
const ALTER_COLUMN_TYPE = new RegExp(String.raw`^ALTER\s+${COLUMN}\s+(?:SET\s+DATA\s+)?TYPE\b`);
const ALTER_COLUMN_SET_NOT_NULL = new RegExp(String.raw`^ALTER\s+${COLUMN}\s+SET\s+NOT\s+NULL\b`);
const ALTER_COLUMN_DROP_DEFAULT = new RegExp(String.raw`^ALTER\s+${COLUMN}\s+DROP\s+DEFAULT\b`);

/** Why one ALTER TABLE action breaks the previous release, or null. */
function destructiveAction(action: string): string | null {
  const a = action.toUpperCase();
  if (/^DROP\s+CONSTRAINT\b/.test(a)) return null;
  if (/^DROP\b/.test(a)) return 'drops a column';
  if (/^RENAME\s+TO\b/.test(a)) return 'renames a table';
  if (/^RENAME\s+(?!CONSTRAINT\b)/.test(a)) return 'renames a column';
  if (/^SET\s+SCHEMA\b/.test(a)) return 'moves a table to another schema';
  if (ALTER_COLUMN_TYPE.test(a)) return "changes a column's type";
  if (ALTER_COLUMN_SET_NOT_NULL.test(a)) return 'makes a column NOT NULL';
  if (ALTER_COLUMN_DROP_DEFAULT.test(a)) return "drops a column's default";
  // ON DELETE/UPDATE SET DEFAULT is a foreign key action, not a column default.
  const hasDefault = /(?<!\bSET\s)\bDEFAULT\b/.test(a);
  if (/^ADD\s+(?!CONSTRAINT\b)/.test(a) && /\bNOT\s+NULL\b/.test(a) && !hasDefault) {
    return 'adds a NOT NULL column without a DEFAULT';
  }
  return null;
}

/** Why one statement breaks the previous release, or null. */
function destructiveStatement(statement: string): string | null {
  const drop = DROP_OBJECT.exec(statement);
  if (drop) return `drops a ${drop[1].toLowerCase().replace(/\s+/g, ' ')}`;
  if (/\bTRUNCATE\b/i.test(statement)) return 'truncates a table';
  if (/\bALTER\s+TYPE\s+\S+\s+RENAME\s+VALUE\b/i.test(statement)) return 'renames an enum value';
  const alter = ALTER_TABLE.exec(statement);
  if (!alter) return null;
  for (const action of splitActions(alter[1])) {
    const reason = destructiveAction(action);
    if (reason) return reason;
  }
  return null;
}

function migrationNumber(name: string): number {
  const m = /^(\d{4})_/.exec(name);
  if (!m) throw new Error(`not a migration file name: ${name}`);
  return Number(m[1]);
}

/**
 * The findings for the files numbered above `after`: each destructive
 * statement in a file without a header naming one of `releasedTags`.
 */
export function lintMigrations(
  files: MigrationFile[],
  opts: { releasedTags: string[]; after: number }
): LintFinding[] {
  const released = new Set(opts.releasedTags);
  const findings: LintFinding[] = [];
  for (const file of files) {
    if (migrationNumber(file.name) <= opts.after) continue;
    const tag = contractFor(file.sql);
    const statements = stripCommentsAndStrings(file.sql)
      .split(';')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    for (const statement of statements) {
      const why = destructiveStatement(statement);
      if (!why) continue;
      if (tag && released.has(tag)) continue;
      findings.push({
        file: file.name,
        statement: statement.slice(0, 200),
        reason: tag
          ? `${why}; its contract-for header names ${tag}, which is not a released tag`
          : `${why}; a contract migration needs a '-- contract-for: vX.Y.Z' header naming the released tag that stopped using it`,
      });
    }
  }
  return findings;
}
