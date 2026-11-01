import { describe, expect, it } from 'vitest';
import { runLocalInstallCommand } from './install-runner';

/**
 * The install runner returns what the command printed, on success as well as
 * on failure (devstation-ext: an agent update shows its result, and a failed
 * one shows its output). Each command runs for real in a real PTY through the
 * platform shell, as an install or update does.
 *
 * Install commands can carry quotes (hermes, goose). On Windows a quoted
 * argument passed through node-pty's argv joining reached cmd.exe as \"…\",
 * so `node -e "process.exit(3)"` evaluated a string literal and reported
 * success (devstation-gs2). The line must reach the shell as written.
 */
describe('runLocalInstallCommand — real PTY', () => {
  it('returns the command output on success', async () => {
    const result = await runLocalInstallCommand('node --version');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.output).toContain(process.version);
  });

  it('returns a failed command’s exit code and output', async () => {
    const result = await runLocalInstallCommand('node --chord-no-such-flag');

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'command-failed', exitCode: 9 });
    expect(result.error).toHaveProperty('output', expect.stringContaining('--chord-no-such-flag'));
  });

  it('runs a quoted argument as written: its exit code is the command’s', async () => {
    const result = await runLocalInstallCommand('node -e "process.exit(3)"');

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error).toMatchObject({ type: 'command-failed', exitCode: 3 });
  });

  // The shape of the vendors' Windows installers (devstation-fez): PowerShell
  // with an environment value, a `;` and a pipe, all inside cmd.exe's quotes.
  it.runIf(process.platform === 'win32')(
    'runs a PowerShell installer line through cmd.exe as written',
    async () => {
      const result = await runLocalInstallCommand(
        `powershell -NoProfile -ExecutionPolicy Bypass -Command "$env:CHORD_PS_CHECK='1'; 'a' | ForEach-Object { 'ps ok ' + $env:CHORD_PS_CHECK }"`
      );

      expect(result).toMatchObject({ success: true });
      if (!result.success) return;
      expect(result.data.output).toContain('ps ok 1');
    }
  );

  it('passes quotes inside a quoted argument through intact', async () => {
    const result = await runLocalInstallCommand(`node -e "console.log('chord ' + 'quoted')"`);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.output).toContain('chord quoted');
  });
});
