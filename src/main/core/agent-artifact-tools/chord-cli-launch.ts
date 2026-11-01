import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import { chordCodexCliArgs, chordCodexMcpServer, type ChordMcpAccess } from './chord-mcp-access';
import { CHORD_MCP_SERVER_NAME } from './chord-server-name';

/**
 * CLIs a terminal session can hand the chord tools to through their own
 * launch flags (plan 2026-09-23 P3 step 4). Every other CLI runs without
 * them: Chord never writes a CLI's own config file to add a server.
 */
export const CHORD_TOOLS_TERMINAL_CLIS = ['claude', 'codex'] as const;

export interface ChordCliLaunch {
  /** Flags to put ahead of the CLI's own arguments (before any subcommand). */
  args: string[];
  env: Record<string, string>;
  /** Removes whatever the launch left on disk; runs when the terminal exits. */
  cleanup: () => void;
}

/**
 * Claude Code takes `--mcp-config` as a file path. Inline JSON would have to
 * survive `cmd.exe` quoting when the CLI is a `.cmd` shim, which it does not,
 * so it is written to Chord's own launch directory — never to the user's
 * Claude config — and deleted when the terminal exits. Turning off Claude
 * Code's built-in Artifact tool (P2 step 3) rides in the session's one
 * `--settings` file (`prepareAgentHookLaunch`): with two `--settings` flags
 * Claude Code applies only the last.
 */
function launchClaudeCli(
  access: ChordMcpAccess,
  sessionId: string,
  launchDir: string
): ChordCliLaunch {
  mkdirSync(launchDir, { recursive: true });
  const mcpConfigPath = join(launchDir, `${sessionId}.mcp.json`);
  writeFileSync(
    mcpConfigPath,
    JSON.stringify({
      mcpServers: {
        [CHORD_MCP_SERVER_NAME]: {
          type: 'http',
          url: access.url,
          headers: { Authorization: `Bearer ${access.token}` },
        },
      },
    }),
    { encoding: 'utf-8', mode: 0o600 }
  );
  return {
    args: ['--mcp-config', mcpConfigPath],
    env: {},
    cleanup: () => {
      rmSync(mcpConfigPath, { force: true });
    },
  };
}

/** The chord tools for a terminal session's CLI, or null for a CLI without such flags. */
export function buildChordCliLaunch(
  providerId: AgentProviderId,
  access: ChordMcpAccess,
  sessionId: string,
  /** Chord's own directory for per-session launch files. */
  launchDir: string
): ChordCliLaunch | null {
  switch (providerId) {
    case 'claude':
      return launchClaudeCli(access, sessionId, launchDir);
    case 'codex':
      return {
        args: chordCodexCliArgs(access),
        env: chordCodexMcpServer(access).env,
        cleanup: () => {},
      };
    default:
      return null;
  }
}
