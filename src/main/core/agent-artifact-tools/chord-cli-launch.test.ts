import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ChordMcpAccess } from './chord-mcp-access';
import { CHORD_MCP_SERVER_NAME } from './chord-server-name';

/**
 * The tool-session registry sits in this module's import graph and opens the
 * app database at import; the Electron-ABI client can't load under Node, so it
 * is a real SQLite built from the shipped migrations (the repo's standard
 * substitution, see publish-artifact.test.ts).
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { buildChordCliLaunch } = await import('./chord-cli-launch');

let launchDir: string;
const access: ChordMcpAccess = {
  url: 'http://127.0.0.1:45123/mcp',
  token: 'tool-session-token',
  dispose: () => {},
};

beforeEach(() => {
  launchDir = mkdtempSync(join(tmpdir(), 'chord-cli-launch-'));
});

afterEach(() => {
  rmSync(launchDir, { recursive: true, force: true });
});

describe('buildChordCliLaunch — Claude Code', () => {
  it('passes the chord MCP server by --mcp-config and leaves --settings to the session’s one flag-settings file', () => {
    const launch = buildChordCliLaunch('claude', access, 'session-1', launchDir)!;

    // Claude Code applies only the last of two --settings flags (probe-bmj),
    // so a second one here would drop Chord's hooks from the terminal.
    expect(launch.args).not.toContain('--settings');
    expect(launch.args[0]).toBe('--mcp-config');
    const mcpConfigPath = launch.args[1]!;
    expect(mcpConfigPath.startsWith(launchDir)).toBe(true);
    const config = JSON.parse(readFileSync(mcpConfigPath, 'utf-8'));
    expect(config.mcpServers[CHORD_MCP_SERVER_NAME]).toEqual({
      type: 'http',
      url: access.url,
      headers: { Authorization: `Bearer ${access.token}` },
    });

    launch.cleanup();
    expect(existsSync(mcpConfigPath)).toBe(false);
  });
});
