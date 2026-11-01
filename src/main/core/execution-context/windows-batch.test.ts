import { existsSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  createEchoFixture,
  TRICKY_ARGS,
  type EchoFixture,
} from '@main/utils/_testing/cmd-exe-echo-fixture';
import { LocalExecutionContext } from './local-execution-context';
import { batchFileInvocation } from './windows-batch';

/**
 * A Windows batch file runs as `cmd.exe /d /s /c "<line>"`, and cmd.exe parses
 * that line, then the batch file's `%*` parses it again: every argument is
 * escaped for both, so quotes, `%`, `!`, `&` and spaces arrive as given
 * (devstation-9ge). A line break ends a cmd.exe line, so it is refused.
 *
 * The round trips run a real `.cmd` through `LocalExecutionContext.exec`.
 */
const isWindows = process.platform === 'win32';
const CMD = 'C:\\tools\\agent.cmd';

const dirs: string[] = [];
const fixtures: EchoFixture[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  for (const fixture of fixtures.splice(0)) fixture.remove();
});

describe('batchFileInvocation', () => {
  it.runIf(isWindows)('passes plain arguments as they are', () => {
    expect(batchFileInvocation(CMD, ['--version', 'prefix', '-g'])).toEqual({
      file: process.env.ComSpec,
      args: [`/d /s /c ""${CMD}" --version prefix -g"`],
    });
  });

  for (const lineBreak of ['\r', '\n']) {
    const shown = JSON.stringify(lineBreak);

    it.runIf(isWindows)(`refuses ${shown} in an argument`, () => {
      expect(() => batchFileInvocation(CMD, [`a${lineBreak}b`])).toThrow(/line break/);
    });

    it.runIf(isWindows)(`refuses ${shown} in the command path`, () => {
      expect(() => batchFileInvocation(`C:\\to${lineBreak}ols\\agent.cmd`, [])).toThrow(
        /line break/
      );
    });
  }
});

describe('LocalExecutionContext — batch file round trip', () => {
  it.runIf(isWindows)(
    'hands an argument with & and spaces over literally, running nothing else',
    async () => {
      const dir = realpathSync(mkdtempSync(join(tmpdir(), 'chord-batch-')));
      dirs.push(dir);
      const script = join(dir, 'echo-args.cmd');
      writeFileSync(script, '@echo off\r\necho ARGS=[%*]\r\n');
      const marker = join(dir, 'injected.txt');

      const { stdout } = await new LocalExecutionContext({ root: dir }).exec(script, [
        'one & echo injected> injected.txt',
        'two words',
      ]);

      expect(stdout.trim()).toBe('ARGS=["one & echo injected> injected.txt" "two words"]');
      expect(existsSync(marker)).toBe(false);
    }
  );

  it.runIf(isWindows)(
    'hands an npm shim every argument as given: quotes, % and ! included',
    async () => {
      const fixture = createEchoFixture();
      fixtures.push(fixture);
      await new LocalExecutionContext({ root: fixture.dir }).exec(fixture.shim, TRICKY_ARGS, {
        env: { ECHO_OUT: fixture.out },
      });

      expect(fixture.readArgs()).toEqual(TRICKY_ARGS);
    },
    30_000
  );
});
