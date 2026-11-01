import {
  DEFAULT_RUN_SCRIPT_ID,
  validateRunScriptId,
  type RunScriptMap,
  type RunScriptsValue,
} from '@shared/run-scripts';

/**
 * Repo › Run & test › Run scripts as rows the user edits. One row with id
 * `default` is the single "Run" field; "Add named script" turns it into id +
 * command rows. A save writes the settings file's own form: a string for the
 * one script, an object for named ones (`@shared/run-scripts`).
 */

export interface RunScriptRow {
  id: string;
  command: string;
}

export interface RunScriptRowError {
  id: string | null;
  command: string | null;
}

const EMPTY_RUN_FIELD: RunScriptRow = { id: DEFAULT_RUN_SCRIPT_ID, command: '' };

export function listRunScriptRows(scripts: RunScriptMap): RunScriptRow[] {
  const rows = Object.entries(scripts).map(([id, command]) => ({ id, command }));
  return rows.length > 0 ? rows : [EMPTY_RUN_FIELD];
}

/** The rows are the single "Run" field, not named scripts. */
export function isSingleRunScript(rows: readonly RunScriptRow[]): boolean {
  return rows.length === 1 && rows[0].id === DEFAULT_RUN_SCRIPT_ID;
}

/** Appends an unnamed row; the single Run field's command, if any, becomes a row to name. */
export function addNamedRunScriptRow(rows: readonly RunScriptRow[]): RunScriptRow[] {
  const unnamed = { id: '', command: '' };
  if (!isSingleRunScript(rows)) return [...rows, unnamed];
  const { command } = rows[0];
  return command.trim() === '' ? [unnamed] : [{ id: '', command }, unnamed];
}

/** Removing the last named row goes back to the one empty Run field. */
export function removeRunScriptRow(rows: readonly RunScriptRow[], index: number): RunScriptRow[] {
  const next = rows.filter((_, i) => i !== index);
  return next.length > 0 ? next : [EMPTY_RUN_FIELD];
}

/** What is wrong with each row, to show next to it; nulls when nothing is. */
export function findRunScriptRowErrors(rows: readonly RunScriptRow[]): RunScriptRowError[] {
  if (isSingleRunScript(rows)) return [{ id: null, command: null }];
  const seen = new Set<string>();
  return rows.map((row) => {
    let id: string | null;
    if (row.id === '') id = 'Name this script.';
    else if (seen.has(row.id)) id = `Another script is already named ${row.id}.`;
    else id = validateRunScriptId(row.id);
    seen.add(row.id);
    return { id, command: row.command.trim() === '' ? 'Enter the command it runs.' : null };
  });
}

/** The value to save, or null to clear it. Throws while a row still has an error. */
export function buildRunScriptsValue(rows: readonly RunScriptRow[]): RunScriptsValue | null {
  if (isSingleRunScript(rows)) {
    const command = rows[0].command.trim();
    return command === '' ? null : command;
  }
  const problems = findRunScriptRowErrors(rows).flatMap((error, index) =>
    [error.id, error.command]
      .filter((message): message is string => message !== null)
      .map((message) => `${rows[index].id || `Script ${index + 1}`}: ${message}`)
  );
  if (problems.length > 0) throw new Error(problems.join(' '));
  if (rows.length === 0) return null;
  return Object.fromEntries(rows.map((row) => [row.id, row.command.trim()]));
}
