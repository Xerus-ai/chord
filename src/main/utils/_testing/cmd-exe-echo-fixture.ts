import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Arguments cmd.exe must not interpret: quotes, `%`/`!` expansions,
 * operators, carets, backslashes before a quote or at the end, empty.
 */
export const TRICKY_ARGS = [
  'plain',
  'hello world',
  'A&B',
  'a"b',
  '"quoted"',
  '100%',
  '%PATH%',
  'x!y',
  'a^b',
  'back\\slash\\',
  'C:\\dir with\\',
  '',
  '<>|',
  '(paren)',
  'semi;comma,',
  'star*?',
  "single'quote",
  '`tick`',
  'unicode é ✓',
  '--format=%(refname)',
  '%%',
  '^&^',
  'a\\"b',
  'tab\there',
];

export interface EchoFixture {
  /** A folder with a space in its path. */
  dir: string;
  /** `echo.js`: writes its argv (after the script) as JSON to `$ECHO_OUT`. */
  echo: string;
  /** An npm cmd-shim for `echo.js`, as `npm i -g` writes one. */
  shim: string;
  /** Where `echo.js` writes. */
  out: string;
  readArgs: () => string[];
  remove: () => void;
}

export function createEchoFixture(): EchoFixture {
  const base = realpathSync(mkdtempSync(join(tmpdir(), 'chord-cmd-line-')));
  const dir = join(base, 'dir with space');
  mkdirSync(dir);
  const echo = join(dir, 'echo.js');
  writeFileSync(
    echo,
    "require('fs').writeFileSync(process.env.ECHO_OUT, JSON.stringify(process.argv.slice(2)));\n"
  );
  const shim = join(dir, 'echo-shim.cmd');
  writeFileSync(
    shim,
    [
      '@ECHO off',
      'GOTO start',
      ':find_dp0',
      'SET dp0=%~dp0',
      'EXIT /b',
      ':start',
      'SETLOCAL',
      'CALL :find_dp0',
      'SET "_prog=node"',
      'endLocal & goto #_undefined_# 2>NUL || title %COMSPEC% & "%_prog%"  "%dp0%\\echo.js" %*',
      '',
    ].join('\r\n')
  );
  const out = join(base, 'out.json');
  return {
    dir,
    echo,
    shim,
    out,
    readArgs: () => JSON.parse(readFileSync(out, 'utf8')) as string[],
    remove: () => rmSync(base, { recursive: true, force: true }),
  };
}
