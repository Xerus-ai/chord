import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import { createEchoFixture, TRICKY_ARGS, type EchoFixture } from './_testing/cmd-exe-echo-fixture';
import { cmdExeCommandLine } from './cmd-exe-command-line';

/**
 * A command that runs through cmd.exe (`/d /s /c "<line>"`) reaches its
 * program only after cmd.exe has parsed the line, and a batch file's `%*`
 * parses it a second time. Every argument must arrive exactly as given.
 * Probed live on Windows 11 (devstation-9ge, `chord-lane-checks/probe-9ge`):
 * caret-escaping a quoted argument once suits a program and twice suits a
 * batch file; the command path is quoted, since a program in a folder with a
 * space reads a caret-escaped path as several arguments.
 */
const isWindows = process.platform === 'win32';

const fixtures: EchoFixture[] = [];
afterEach(() => {
  for (const fixture of fixtures.splice(0)) fixture.remove();
});

function echoFixture(): EchoFixture {
  const fixture = createEchoFixture();
  fixtures.push(fixture);
  return fixture;
}

function runThroughCmdExe(line: string, fixture: EchoFixture): string[] {
  const result = spawnSync(process.env.ComSpec ?? 'cmd.exe', [line], {
    windowsVerbatimArguments: true,
    env: { ...process.env, ECHO_OUT: fixture.out },
    encoding: 'utf8',
  });
  expect(result.status, result.stderr).toBe(0);
  return fixture.readArgs();
}

describe('cmdExeCommandLine', () => {
  it('quotes the command path and leaves plain arguments bare', () => {
    expect(
      cmdExeCommandLine('C:\\Program Files\\nodejs\\pnpm.cmd', ['run', 'dev', '--watch'], 'batch')
    ).toBe('/d /s /c ""C:\\Program Files\\nodejs\\pnpm.cmd" run dev --watch"');
  });

  it("quotes an argument with = or a comma, which a batch file's %1 splits at", () => {
    expect(cmdExeCommandLine('tool', ['--port=3000', 'a,b'], 'program')).toBe(
      '/d /s /c ""tool" ^"--port=3000^" ^"a^,b^""'
    );
  });

  it("caret-escapes a program's argument once, quotes included", () => {
    expect(cmdExeCommandLine('codex', ['A&B', '100%'], 'program')).toBe(
      '/d /s /c ""codex" ^"A^&B^" ^"100^%^""'
    );
  });

  it("caret-escapes a batch file's argument twice, for its %* parse", () => {
    expect(cmdExeCommandLine('C:\\npm\\codex.cmd', ['hello world'], 'batch')).toBe(
      '/d /s /c ""C:\\npm\\codex.cmd" ^^^"hello^^^ world^^^""'
    );
  });

  it('escapes a quote and the backslashes before it the way a program reads its argv', () => {
    expect(cmdExeCommandLine('tool', ['a\\"b', 'end\\'], 'program')).toBe(
      '/d /s /c ""tool" ^"a\\\\\\^"b^" end\\"'
    );
  });

  for (const lineBreak of ['\n', '\r', '\r\n']) {
    it(`refuses a line break (${JSON.stringify(lineBreak)}), which ends a cmd.exe line`, () => {
      expect(() => cmdExeCommandLine('tool.cmd', [`one${lineBreak}two`], 'batch')).toThrow(
        /line break/
      );
      expect(() => cmdExeCommandLine(`C:\\a${lineBreak}b\\tool.cmd`, [], 'batch')).toThrow(
        /line break/
      );
    });
  }

  it('refuses a quote in the command path, which no Windows path holds', () => {
    expect(() => cmdExeCommandLine('C:\\a"b\\tool.cmd', [], 'batch')).toThrow(/quote/);
  });
});

describe('cmdExeCommandLine — round trip through cmd.exe', () => {
  it.runIf(isWindows)(
    'hands every argument to an npm shim in a folder with a space exactly as given',
    () => {
      const fixture = echoFixture();

      expect(
        runThroughCmdExe(cmdExeCommandLine(fixture.shim, TRICKY_ARGS, 'batch'), fixture)
      ).toEqual(TRICKY_ARGS);
    },
    30_000
  );

  it.runIf(isWindows)(
    'hands every argument to a program exactly as given',
    () => {
      const fixture = echoFixture();
      const line = cmdExeCommandLine(process.execPath, [fixture.echo, ...TRICKY_ARGS], 'program');

      expect(runThroughCmdExe(line, fixture)).toEqual(TRICKY_ARGS);
    },
    30_000
  );
});
