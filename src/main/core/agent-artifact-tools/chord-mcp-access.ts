import { join } from 'node:path';
import type { McpServer as AcpMcpServer } from '@agentclientprotocol/sdk';
import { app } from 'electron';
import type { JsonValue } from '@main/core/codex-app-server/protocol/serde_json/JsonValue';
import { unpackedAsarPath } from '@main/utils/unpacked-asar-path';
import { registerArtifactToolSession, type ArtifactToolSession } from './artifact-tool-sessions';
import { ensureChordMcpEndpoint } from './chord-mcp-endpoint';
import { CHORD_MCP_SERVER_NAME } from './chord-server-name';

/**
 * One out-of-process agent session's way in to the `chord` tools: a bearer
 * token for its tool session, and the loopback endpoint that honours it.
 * Disposing ends the token — a tool call after the session ends is refused.
 */
export interface ChordMcpAccess {
  url: string;
  token: string;
  dispose: () => void;
}

export async function openChordMcpAccess(session: ArtifactToolSession): Promise<ChordMcpAccess> {
  const { url } = await ensureChordMcpEndpoint();
  const { token, dispose } = registerArtifactToolSession(session);
  return { url, token, dispose };
}

/**
 * The stdio shim (src/chord-mcp-shim), built to `out/chord-mcp/`. It is run
 * with Chord's own executable in Node mode, so no separate Node install is
 * needed; `spawn` cannot run a file inside `app.asar`, so a packaged app
 * addresses the unpacked copy (electron-builder.config.ts `asarUnpack`).
 */
function chordMcpShimPath(): string {
  const bundled = join(app.getAppPath(), 'out', 'chord-mcp', 'chord-mcp-stdio.cjs');
  return unpackedAsarPath(bundled) ?? bundled;
}

/** How a stdio-only client launches the shim: command, argv and environment. */
export function chordMcpStdioLaunch(access: ChordMcpAccess): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  return {
    command: process.execPath,
    args: [chordMcpShimPath()],
    env: {
      ELECTRON_RUN_AS_NODE: '1',
      CHORD_MCP_URL: access.url,
      CHORD_MCP_TOKEN: access.token,
    },
  };
}

/**
 * The `session/new` entry for an ACP agent. HTTP when the agent said in
 * `initialize` that it takes HTTP MCP servers; otherwise the stdio shim,
 * which every ACP agent must support.
 */
export function chordAcpMcpServer(
  access: ChordMcpAccess,
  transport: { http: boolean }
): AcpMcpServer {
  if (transport.http) {
    return {
      type: 'http',
      name: CHORD_MCP_SERVER_NAME,
      url: access.url,
      headers: [{ name: 'Authorization', value: `Bearer ${access.token}` }],
    };
  }
  const launch = chordMcpStdioLaunch(access);
  return {
    name: CHORD_MCP_SERVER_NAME,
    command: launch.command,
    args: launch.args,
    env: Object.entries(launch.env).map(([name, value]) => ({ name, value })),
  };
}

/** The variable Codex reads the bearer token from (`bearer_token_env_var`). */
const CODEX_TOKEN_ENV = 'CHORD_MCP_TOKEN';

/**
 * Codex's `mcp_servers.chord` entry: the HTTP endpoint, with the token read
 * from the Codex process's environment so it never appears in argv or config.
 * Applied as overrides — a thread's `config` on `thread/start`/`thread/resume`,
 * or `-c` flags for the CLI — so Codex's own config file is never written.
 *
 * In a chat thread the chord tools are pre-approved (`approve`): Codex asks
 * for an MCP tool call through an elicitation request, which Chord's Codex
 * chat has no card for (`codex-session.ts` `handleServerRequest` refuses it),
 * so a prompting tool could never run. The chord tools only publish a file the
 * agent already wrote into its workspace, or read the artifact list. A
 * terminal keeps Codex's own prompt: the user answers it in the terminal.
 */
export function chordCodexMcpServer(access: ChordMcpAccess): {
  config: { [key: string]: JsonValue };
  env: Record<string, string>;
} {
  return {
    config: {
      [`mcp_servers.${CHORD_MCP_SERVER_NAME}`]: {
        url: access.url,
        bearer_token_env_var: CODEX_TOKEN_ENV,
        default_tools_approval_mode: 'approve',
      },
    },
    env: { [CODEX_TOKEN_ENV]: access.token },
  };
}

/**
 * The same entry as Codex CLI `-c` flags, for a terminal session. Values are
 * TOML literal strings: the URL and the variable name hold no quote of any
 * kind, so they pass through `cmd.exe` and node-pty quoting unchanged.
 */
export function chordCodexCliArgs(access: ChordMcpAccess): string[] {
  const prefix = `mcp_servers.${CHORD_MCP_SERVER_NAME}`;
  return [
    '-c',
    `${prefix}.url='${access.url}'`,
    '-c',
    `${prefix}.bearer_token_env_var='${CODEX_TOKEN_ENV}'`,
  ];
}
