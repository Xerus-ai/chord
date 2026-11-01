import type { Settings } from '@anthropic-ai/claude-agent-sdk';
import type { ClaudeExecutableConfig } from '@main/core/workspaces/executable-bundle';

/**
 * How a chat loads the repository's Claude config. What runs code is loaded
 * only once the user approved it; after Don't run:
 *   - a settings file that carries hooks, an `env` block or a helper command,
 *     or skill/subagent/command files that run code (`definitions`, loaded
 *     with the project source), is left out as a whole (its setting
 *     source), since an override can't
 *     take those back without also taking the user's own: flag-layer
 *     `disableAllHooks` silences ~/.claude hooks too (probe, devstation-1t2).
 *     Leaving out `.claude/settings.json` leaves the repository's CLAUDE.md
 *     out with it (`dropsProjectGuidance`, which the prompt says); a
 *     committed `.claude/settings.local.json` goes alone.
 *   - `.mcp.json` servers are turned off by name (`disabledMcpjsonServers`).
 *
 * An SDK session never shows Claude Code's own folder-trust dialog and does
 * not apply the repository's `permissions.allow` unless the folder is
 * trusted, so grants need no override.
 */

export type ClaudeSettingSource = 'user' | 'project' | 'local';

export interface ClaudeProjectGate {
  settingSources: ClaudeSettingSource[];
  settings: Pick<Settings, 'disabledMcpjsonServers'>;
  dropsProjectGuidance: boolean;
}

const ALL_SOURCES: ClaudeSettingSource[] = ['user', 'project', 'local'];

/** Settings keys that run code when the file loads, and that no override can take away alone. */
const RUNS_CODE_KEYS = [
  'hooks',
  'env',
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'otelHeadersHelper',
] as const;

function runsCode(settings: Record<string, unknown> | undefined): boolean {
  return settings !== undefined && RUNS_CODE_KEYS.some((key) => settings[key] !== undefined);
}

export function buildClaudeProjectGate(args: {
  claude: ClaudeExecutableConfig;
  approved: boolean;
}): ClaudeProjectGate {
  const { claude } = args;
  if (args.approved || Object.keys(claude).length === 0) {
    return { settingSources: ALL_SOURCES, settings: {}, dropsProjectGuidance: false };
  }
  // Skill, subagent and command files load with the project source.
  const dropProject = runsCode(claude.settings) || claude.definitions !== undefined;
  const dropLocal = runsCode(claude.localSettings);
  const settings: ClaudeProjectGate['settings'] = {};
  if (claude.mcpServers) {
    settings.disabledMcpjsonServers = Object.keys(claude.mcpServers);
  }
  return {
    settingSources: ALL_SOURCES.filter(
      (source) => !(source === 'project' && dropProject) && !(source === 'local' && dropLocal)
    ),
    settings,
    dropsProjectGuidance: dropProject,
  };
}
