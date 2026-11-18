/**
 * Release preflight's migration lint (design C5, F8; devstation-5s42).
 *
 * A deploy migrates while the previous release is still serving, and flips
 * back to it when the new one is unhealthy (server/deploy/deploy.sh). So every
 * migration must leave a schema the previous release still works against:
 * expand/contract. A file that drops a table or column, renames a column,
 * changes a column's type, adds a NOT NULL column without a DEFAULT, adds a
 * UNIQUE/CHECK/FOREIGN KEY constraint or a unique index (the previous release
 * can write rows it rejects), or drops a constraint or an index (its ON CONFLICT
 * may need the key) is the contract half, DDL that EXECUTE runs from a string
 * included, and ships only with a header naming the released tag that
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

/** A literal that EXECUTE (or EXECUTE format(...)) runs: its text is SQL that still runs. */
const EXECUTED_LITERAL = /\bEXECUTE\s*(?:format\s*\(\s*)?$/i;

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
      const start = i + 1;
      i++;
      while (i < sql.length) {
        if (sql[i] === c && sql[i + 1] === c) i += 2;
        else if (sql[i] === c) break;
        else i++;
      }
      const body = sql.slice(start, i);
      i++;
      if (c === "'" && EXECUTED_LITERAL.test(out)) out += ` ${body.replace(/''/g, "'")} `;
      else out += c === "'" ? "''" : '"q"';
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
function destructiveAction(action: string, swapped: Set<string>): string | null {
  const a = action.toUpperCase();
  const dropped = /^DROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\S+)/.exec(a);
  if (dropped) {
    if (swapped.has(dropped[1])) return null;
    return "drops a constraint: if the previous release's ON CONFLICT names its key, that release breaks";
  }
  const added =
    /^ADD\s+(?:CONSTRAINT\s+(\S+)\s+)?(?:UNIQUE|CHECK|FOREIGN\s+KEY|PRIMARY\s+KEY|EXCLUDE|NOT\s+NULL)\b/.exec(
      a
    );
  if (added) {
    if (added[1] && swapped.has(added[1])) return null;
    return "adds a constraint the previous release's writes may violate";
  }
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
function destructiveStatement(statement: string, swapped: Set<string>): string | null {
  const drop = DROP_OBJECT.exec(statement);
  if (drop) return `drops a ${drop[1].toLowerCase().replace(/\s+/g, ' ')}`;
  if (/\bTRUNCATE\b/i.test(statement)) return 'truncates a table';
  if (/\bDROP\s+INDEX\b/i.test(statement)) {
    return "drops an index: if it is the previous release's ON CONFLICT target, that release breaks";
  }
  if (/\bCREATE\s+UNIQUE\s+INDEX\b/i.test(statement)) {
    return "adds a unique index the previous release's writes may violate";
  }
  if (/\bALTER\s+TYPE\s+\S+\s+RENAME\s+VALUE\b/i.test(statement)) return 'renames an enum value';
  const alter = ALTER_TABLE.exec(statement);
  if (!alter) return null;
  for (const action of splitActions(alter[1])) {
    const reason = destructiveAction(action, swapped);
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
 * Constraint names a file both drops and adds back: a swap (e.g. a foreign key
 * re-created with another ON DELETE action) keeps the key, so neither half is
 * flagged.
 */
function swappedConstraints(stripped: string): Set<string> {
  const names = (re: RegExp) => new Set([...stripped.matchAll(re)].map((m) => m[1].toUpperCase()));
  const dropped = names(/\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?(\S+?)\s*[,;]/gi);
  const added = names(/\bADD\s+CONSTRAINT\s+(\S+)\s/gi);
  return new Set([...dropped].filter((n) => added.has(n) && n !== '"Q"'));
}

/**
 * Each EXECUTE whose argument is not one plain string literal (or format() of
 * one): concatenation, a variable, E'...' or parentheses hide the SQL it runs.
 */
function dynamicExecutes(sql: string): string[] {
  const text = sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
  const plain = /^\s*(?:format\s*\(\s*)?'(?:[^']|'')*'\s*(?:;|,|\)|$)/i;
  const out: string[] = [];
  for (const m of text.matchAll(/\bEXECUTE\b/gi)) {
    const rest = text.slice((m.index ?? 0) + m[0].length);
    // A trigger's EXECUTE FUNCTION/PROCEDURE names a function: not dynamic SQL.
    if (/^\s*(?:FUNCTION|PROCEDURE)\b/i.test(rest)) continue;
    if (!plain.test(rest)) out.push(`EXECUTE${rest.slice(0, 80)}`.replace(/\s+/g, ' ').trim());
  }
  return out;
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
    const stripped = stripCommentsAndStrings(file.sql);
    const statements = stripped
      .split(';')
      .map((s) => s.replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const swapped = swappedConstraints(stripped);
    const checks: { statement: string; why: string }[] = [];
    for (const statement of statements) {
      const why = destructiveStatement(statement, swapped);
      if (why) checks.push({ statement, why });
    }
    for (const snippet of dynamicExecutes(file.sql)) {
      checks.push({
        statement: snippet,
        why: 'runs dynamic SQL (EXECUTE of something other than one string literal) the lint cannot read',
      });
    }
    for (const { statement, why } of checks) {
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

/**
 * The tags a contract-for header may name when linting the files since `since`:
 * the release tags in its history, so a tag cut after the previous release does
 * not vouch for it. A hotfix tag counts only once its release branch is merged
 * back into the line `since` was cut from.
 */
export function releasedTagsAt(since: string, git: (...args: string[]) => string): string[] {
  return git('tag', '--merged', since, '--list', 'v*').split('\n').filter(Boolean);
}
