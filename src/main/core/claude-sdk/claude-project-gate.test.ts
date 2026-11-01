import { describe, expect, it } from 'vitest';
import { buildClaudeProjectGate } from './claude-project-gate';

const ALL = ['user', 'project', 'local'];

describe('buildClaudeProjectGate', () => {
  it('loads everything when the repository supplies no Claude config that runs code', () => {
    expect(buildClaudeProjectGate({ claude: {}, approved: false })).toEqual({
      settingSources: ALL,
      settings: {},
      dropsProjectGuidance: false,
    });
  });

  it('loads everything once the user approved it', () => {
    const claude = {
      settings: { hooks: { Stop: [] }, env: { A: '1' } },
      mcpServers: { db: { command: 'node' } },
    };
    expect(buildClaudeProjectGate({ claude, approved: true })).toEqual({
      settingSources: ALL,
      settings: {},
      dropsProjectGuidance: false,
    });
  });

  it("turns the repository's MCP servers off by name after Don't run, keeping its guidance", () => {
    const claude = { mcpServers: { db: { command: 'node' }, search: { command: 'npx' } } };
    expect(buildClaudeProjectGate({ claude, approved: false })).toEqual({
      settingSources: ALL,
      settings: { disabledMcpjsonServers: ['db', 'search'] },
      dropsProjectGuidance: false,
    });
  });

  // devstation-1t2 (probe 2026-10-03, Claude Code 2.1.265): `disableAllHooks`
  // at the flag layer also silences the user's own ~/.claude hooks. Leaving
  // the repository's settings source out stops only its hooks.
  it("leaves the repository's project settings out when they carry hooks, never disabling all hooks", () => {
    const claude = {
      settings: { hooks: { Stop: [] } },
      mcpServers: { db: { command: 'node' } },
    };
    expect(buildClaudeProjectGate({ claude, approved: false })).toEqual({
      settingSources: ['user', 'local'],
      settings: { disabledMcpjsonServers: ['db'] },
      dropsProjectGuidance: true,
    });
  });

  it('leaves project settings out when they carry env or a helper command no override can remove', () => {
    for (const settings of [
      { env: { NODE_OPTIONS: '--require ./x.js' } },
      { apiKeyHelper: './key.sh' },
      { awsAuthRefresh: './aws.sh' },
      { awsCredentialExport: './aws.sh' },
      { otelHeadersHelper: './otel.sh' },
    ]) {
      expect(buildClaudeProjectGate({ claude: { settings }, approved: false })).toEqual({
        settingSources: ['user', 'local'],
        settings: {},
        dropsProjectGuidance: true,
      });
    }
  });

  it('leaves out only a committed settings.local.json that runs code, so CLAUDE.md still loads', () => {
    for (const localSettings of [{ hooks: { Stop: [] } }, { env: { A: '1' } }]) {
      expect(buildClaudeProjectGate({ claude: { localSettings }, approved: false })).toEqual({
        settingSources: ['user', 'project'],
        settings: {},
        dropsProjectGuidance: false,
      });
    }
  });

  // devstation-493: skills, subagents and commands load with the project source.
  it('leaves the project source out when its skill, subagent or command files run code', () => {
    const claude = { definitions: { '.claude/commands/ship.md': '!`./ship.sh`' } };
    expect(buildClaudeProjectGate({ claude, approved: false })).toEqual({
      settingSources: ['user', 'local'],
      settings: {},
      dropsProjectGuidance: true,
    });
  });

  it('needs no override for capability grants, which an unapproved SDK session does not apply', () => {
    const claude = { settings: { permissions: { allow: ['Bash(*)'] } } };
    expect(buildClaudeProjectGate({ claude, approved: false })).toEqual({
      settingSources: ALL,
      settings: {},
      dropsProjectGuidance: false,
    });
  });
});
