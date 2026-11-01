import { describe, expect, it } from 'vitest';
import {
  addNamedRunScriptRow,
  buildRunScriptsValue,
  findRunScriptRowErrors,
  isSingleRunScript,
  listRunScriptRows,
  removeRunScriptRow,
} from './run-script-rows';

/**
 * Repo › Run & test › Run scripts, as rows the user edits: one "Run" field
 * (the default script) until "Add named script" turns it into id + command
 * rows. What a save writes is the team file's own form: a string for the one
 * script, an object for named ones.
 */
describe('run script rows', () => {
  it('starts as one empty Run field when there are no run scripts', () => {
    const rows = listRunScriptRows({});
    expect(rows).toEqual([{ id: 'default', command: '' }]);
    expect(isSingleRunScript(rows)).toBe(true);
  });

  it('shows the default script as the one Run field', () => {
    const rows = listRunScriptRows({ default: 'pnpm dev' });
    expect(rows).toEqual([{ id: 'default', command: 'pnpm dev' }]);
    expect(isSingleRunScript(rows)).toBe(true);
  });

  it('shows named scripts as rows, in order', () => {
    const rows = listRunScriptRows({ web: 'pnpm web', api: 'pnpm api' });
    expect(rows).toEqual([
      { id: 'web', command: 'pnpm web' },
      { id: 'api', command: 'pnpm api' },
    ]);
    expect(isSingleRunScript(rows)).toBe(false);
  });

  it('turns an empty Run field into one unnamed row', () => {
    expect(addNamedRunScriptRow([{ id: 'default', command: '' }])).toEqual([
      { id: '', command: '' },
    ]);
  });

  it('keeps a Run command when adding a named script, asking for its name too', () => {
    expect(addNamedRunScriptRow([{ id: 'default', command: 'pnpm dev' }])).toEqual([
      { id: '', command: 'pnpm dev' },
      { id: '', command: '' },
    ]);
  });

  it('appends an unnamed row to named ones', () => {
    expect(addNamedRunScriptRow([{ id: 'web', command: 'pnpm web' }])).toEqual([
      { id: 'web', command: 'pnpm web' },
      { id: '', command: '' },
    ]);
  });

  it('goes back to the one empty Run field when the last named row is removed', () => {
    const rows = [
      { id: 'web', command: 'pnpm web' },
      { id: 'api', command: 'pnpm api' },
    ];
    expect(removeRunScriptRow(rows, 0)).toEqual([{ id: 'api', command: 'pnpm api' }]);
    expect(removeRunScriptRow([{ id: 'api', command: 'pnpm api' }], 0)).toEqual([
      { id: 'default', command: '' },
    ]);
  });
});

describe('findRunScriptRowErrors', () => {
  it('finds nothing wrong with the one Run field, empty or not', () => {
    expect(findRunScriptRowErrors([{ id: 'default', command: '' }])).toEqual([
      { id: null, command: null },
    ]);
    expect(findRunScriptRowErrors([{ id: 'default', command: 'pnpm dev' }])).toEqual([
      { id: null, command: null },
    ]);
  });

  it('asks for a name and a command on each named row', () => {
    const [error] = findRunScriptRowErrors([{ id: '', command: ' ' }]);
    expect(error.id).toMatch(/name/i);
    expect(error.command).toMatch(/command/i);
  });

  it('refuses an id outside the allowed form, and `default`', () => {
    const errors = findRunScriptRowErrors([
      { id: 'Web', command: 'a' },
      { id: 'default', command: 'b' },
      { id: 'ok-1', command: 'c' },
    ]);
    expect(errors[0].id).toMatch(/lowercase letters, digits and dashes/);
    expect(errors[1].id).toMatch(/default/);
    expect(errors[2]).toEqual({ id: null, command: null });
  });

  it('refuses the same id twice, on the later row', () => {
    const errors = findRunScriptRowErrors([
      { id: 'web', command: 'a' },
      { id: 'web', command: 'b' },
    ]);
    expect(errors[0].id).toBeNull();
    expect(errors[1].id).toMatch(/web/);
  });
});

describe('buildRunScriptsValue', () => {
  it('writes the one Run field as a string, trimmed, or clears it when empty', () => {
    expect(buildRunScriptsValue([{ id: 'default', command: '  pnpm dev \n' }])).toBe('pnpm dev');
    expect(buildRunScriptsValue([{ id: 'default', command: '  ' }])).toBeNull();
  });

  it('writes named rows as an object, even a single one, with trimmed commands', () => {
    expect(
      buildRunScriptsValue([
        { id: 'web', command: ' pnpm web ' },
        { id: 'api', command: 'pnpm api' },
      ])
    ).toEqual({ web: 'pnpm web', api: 'pnpm api' });
    expect(buildRunScriptsValue([{ id: 'web', command: 'pnpm web' }])).toEqual({
      web: 'pnpm web',
    });
  });

  it('refuses rows that still have an error', () => {
    expect(() => buildRunScriptsValue([{ id: 'Web', command: 'pnpm web' }])).toThrow(/Web/);
    expect(() =>
      buildRunScriptsValue([
        { id: 'web', command: 'a' },
        { id: 'web', command: 'b' },
      ])
    ).toThrow(/web/);
  });
});
