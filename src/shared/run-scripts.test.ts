import { describe, expect, it } from 'vitest';
import {
  collapseRunScripts,
  DEFAULT_RUN_SCRIPT_ID,
  expandRunScripts,
  formatRunScriptRowTitle,
  formatRunScriptTitle,
  RUN_MODES,
  validateRunScriptId,
} from './run-scripts';

/**
 * `scripts.run` is written two ways (plan §"Decisions for Phase 4", Config):
 * a string is the one run script, id `default`; an object names several.
 * `default` is never a named id, so the two forms cannot describe the same
 * scripts differently.
 */
describe('run script ids', () => {
  it('accepts lowercase letters, digits and dashes, starting with a letter or digit, up to 32', () => {
    for (const id of ['web', 'api-2', '0', 'a'.repeat(32), 'x-y-z']) {
      expect(validateRunScriptId(id)).toBeNull();
    }
  });

  it('refuses anything else, saying what an id may be', () => {
    for (const id of ['', 'Web', '-web', 'web_api', 'web api', 'a'.repeat(33), 'wéb']) {
      expect(validateRunScriptId(id)).toMatch(/lowercase letters, digits and dashes/);
    }
  });

  it('refuses `default`, which is the single run script written as a string', () => {
    expect(DEFAULT_RUN_SCRIPT_ID).toBe('default');
    expect(validateRunScriptId('default')).toMatch(/default.*string/);
  });

  it('has two run modes, per worktree first', () => {
    expect(RUN_MODES).toEqual(['perWorktree', 'solo']);
  });
});

describe('expandRunScripts', () => {
  it('reads a string as the default script', () => {
    expect(expandRunScripts('pnpm dev')).toEqual({ default: 'pnpm dev' });
  });

  it('reads named scripts as they are', () => {
    expect(expandRunScripts({ web: 'pnpm web', api: 'pnpm api' })).toEqual({
      web: 'pnpm web',
      api: 'pnpm api',
    });
  });

  it('reads no value as no scripts', () => {
    expect(expandRunScripts(undefined)).toEqual({});
  });
});

describe('collapseRunScripts', () => {
  it('writes the default script alone back as a string', () => {
    expect(collapseRunScripts({ default: 'pnpm dev' })).toBe('pnpm dev');
  });

  it('writes named scripts as an object, keeping their order', () => {
    const value = collapseRunScripts({ web: 'pnpm web', api: 'pnpm api' });
    expect(value).toEqual({ web: 'pnpm web', api: 'pnpm api' });
    expect(Object.keys(value as object)).toEqual(['web', 'api']);
  });

  it('writes no scripts as no value', () => {
    expect(collapseRunScripts({})).toBeUndefined();
  });

  it('refuses the default script next to named ones: no file can say that', () => {
    expect(() => collapseRunScripts({ default: 'pnpm dev', web: 'pnpm web' })).toThrow(/default/);
  });

  it('round-trips both forms', () => {
    expect(collapseRunScripts(expandRunScripts('pnpm dev'))).toBe('pnpm dev');
    expect(collapseRunScripts(expandRunScripts({ web: 'a' }))).toEqual({ web: 'a' });
  });
});

describe('run script titles', () => {
  it('names a script by its kind where kinds mix (the trust prompt, Repo › Trust)', () => {
    expect(formatRunScriptTitle(DEFAULT_RUN_SCRIPT_ID)).toBe('Run script');
    expect(formatRunScriptTitle('web')).toBe('Run script · web');
  });

  it("names a row inside the Run tab's Run scripts section by its id alone, the default as Run", () => {
    expect(formatRunScriptRowTitle(DEFAULT_RUN_SCRIPT_ID)).toBe('Run');
    expect(formatRunScriptRowTitle('web')).toBe('web');
    expect(formatRunScriptRowTitle('api-2')).toBe('api-2');
  });
});
