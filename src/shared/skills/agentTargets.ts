import * as os from 'os';
import * as path from 'path';

export interface AgentSyncTarget {
  id: string;
  name: string;
  /** Directory where the agent looks for skills/commands */
  getSkillDir: (skillId: string) => string;
  /** Top-level config dir to check if agent is installed */
  configDir: string;
  /** Repo-relative config dir the agent reads project commands/skills from */
  projectDirName: string;
}

const home = os.homedir();

/**
 * Agents that Chord syncs skills INTO (symlinks from ~/.agentskills/).
 * Each agent has its own native directory for skills/commands.
 */
export const agentTargets: AgentSyncTarget[] = [
  {
    id: 'claude',
    projectDirName: '.claude',
    name: 'Claude Code',
    configDir: path.join(home, '.claude'),
    getSkillDir: (skillId: string) => path.join(home, '.claude', 'commands', skillId),
  },
  {
    id: 'codex',
    projectDirName: '.codex',
    name: 'Codex',
    configDir: path.join(home, '.codex'),
    getSkillDir: (skillId: string) => path.join(home, '.codex', 'skills', skillId),
  },
  {
    id: 'opencode',
    projectDirName: '.opencode',
    name: 'OpenCode',
    configDir: path.join(home, '.config', 'opencode'),
    getSkillDir: (skillId: string) => path.join(home, '.config', 'opencode', 'skills', skillId),
  },
  {
    id: 'cursor',
    projectDirName: '.cursor',
    name: 'Cursor',
    configDir: path.join(home, '.cursor'),
    getSkillDir: (skillId: string) => path.join(home, '.cursor', 'skills', skillId),
  },
  {
    id: 'gemini',
    projectDirName: '.gemini',
    name: 'Gemini CLI',
    configDir: path.join(home, '.gemini'),
    getSkillDir: (skillId: string) => path.join(home, '.gemini', 'skills', skillId),
  },
  {
    id: 'roo',
    projectDirName: '.roo',
    name: 'Roo Code',
    configDir: path.join(home, '.roo'),
    getSkillDir: (skillId: string) => path.join(home, '.roo', 'skills', skillId),
  },
  {
    id: 'mistral',
    projectDirName: '.vibe',
    name: 'Mistral Vibe',
    configDir: path.join(home, '.vibe'),
    getSkillDir: (skillId: string) => path.join(home, '.vibe', 'skills', skillId),
  },
];

/**
 * All global directories where agents store skills.
 * Derived from agentTargets (parent dir of each skill dir) plus shared/cross-agent paths.
 * Used to discover externally-installed skills (not installed through Chord).
 */
export const skillScanPaths: string[] = [
  // Auto-derive from agent targets (e.g. ~/.claude/commands, ~/.codex/skills)
  ...new Set(agentTargets.map((t) => path.dirname(t.getSkillDir('_placeholder')))),
  // Additional paths some agents read from (not covered by targets above)
  path.join(home, '.claude', 'skills'),
  path.join(home, '.agent', 'skills'),
  path.join(home, '.agents', 'skills'),
];
