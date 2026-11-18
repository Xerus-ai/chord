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
 * The SQL with comments and quoted strings blanked, so a DROP TABLE inside a
 * comment or a string literal is not a statement. Dollar-quoted bodies (DO $$
 * blocks) are kept as SQL: DDL inside them still runs.
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
    } else if (c === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") i += 2;
        else if (sql[i] === "'") break;
        else i++;
      }
      i++;
      out += "''";
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

const ALTER_TABLE = /^ALTER TABLE\s+(?:IF EXISTS\s+)?(?:ONLY\s+)?("[^"]+"|\S+)\s+([\s\S]*)$/i;

/** Why one ALTER TABLE action breaks the previous release, or null. */
function destructiveAction(action: string): string | null {
  const a = action.toUpperCase();
  if (/^DROP\s+CONSTRAINT\b/.test(a)) return null;
  if (/^DROP\b/.test(a)) return 'drops a column';
  if (/^RENAME\s+(?!TO\b|CONSTRAINT\b)/.test(a)) return 'renames a column';
  if (
    /^ALTER\s+COLUMN\s+("[^"]+"|\S+)\s+(?:SET\s+DATA\s+)?TYPE\b/.test(a) ||
    /^ALTER\s+(?!COLUMN\b)("[^"]+"|\S+)\s+(?:SET\s+DATA\s+)?TYPE\b/.test(a)
  ) {
    return "changes a column's type";
  }
  if (/^ADD\s+(?!CONSTRAINT\b)/.test(a) && /\bNOT\s+NULL\b/.test(a) && !/\bDEFAULT\b/.test(a)) {
    return 'adds a NOT NULL column without a DEFAULT';
  }
  return null;
}

/** Why one statement breaks the previous release, or null. */
function destructiveStatement(statement: string): string | null {
  if (/^DROP\s+TABLE\b/i.test(statement)) return 'drops a table';
  const alter = ALTER_TABLE.exec(statement);
  if (!alter) return null;
  for (const action of splitActions(alter[2])) {
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
