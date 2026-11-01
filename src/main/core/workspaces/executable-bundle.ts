import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { collapseRunScripts, expandRunScripts, type RunScriptsValue } from '@shared/run-scripts';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import type { ResolvedRepoConfig } from '@main/core/repo-config/resolve-repo-config';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { readDefinitionCode, readDefinitionCodeAtRef } from './claude-definition-files';

/**
 * Everything a repository supplies that runs code on this machine, as one
 * bundle the user approves by hash: its committed `.chord.json` scripts, and
 * the Claude config in the lane's checkout that runs code or widens what the
 * agent may do without asking, including what skill, subagent and command
 * files run. Guidance (CLAUDE.md, AGENTS.md, the prose of commands and agent
 * prompts) is not in it — that always reaches the agent.
 *
 * The Claude keys are the ones Claude Code's own folder trust gates
 * (code.claude.com/docs/en/permissions, "What runs before you trust a folder").
 */

export interface ChordScripts {
  setup?: string;
  /**
   * As the team file writes it — a string, or named scripts — so an approval
   * given for a string `run` keeps its hash.
   */
  run?: RunScriptsValue;
  test?: string;
  teardown?: string;
  shellSetup?: string;
}

export interface ClaudeExecutableConfig {
  settings?: Record<string, unknown>;
  /** `.claude/settings.local.json`, only when it is committed (then it is the repository's). */
  localSettings?: Record<string, unknown>;
  mcpServers?: Record<string, unknown>;
  /** Skill, subagent and command files that run code: that code, by file path (`claude-definition-files.ts`). */
  definitions?: Record<string, string>;
}

export interface BundleContent {
  chord: ChordScripts;
  claude: ClaudeExecutableConfig;
}

export interface ExecutableBundle {
  hash: string;
  content: BundleContent;
}

/** Settings keys that run a command or configure what runs. */
const EXECUTABLE_SETTINGS_KEYS = [
  'hooks',
  'env',
  'apiKeyHelper',
  'awsAuthRefresh',
  'awsCredentialExport',
  'otelHeadersHelper',
  'statusLine',
  'extraKnownMarketplaces',
] as const;

/** `permissions` keys that grant capability; `deny`/`ask` only restrict. */
const GRANTING_PERMISSION_KEYS = ['allow', 'additionalDirectories'] as const;

/** The team file's scripts — a just-me or default value is the user's own and needs no approval. */
export function collectChordScripts(config: ResolvedRepoConfig): ChordScripts {
  const scripts: ChordScripts = {};
  // Type-only import above: this module loads without the database.
  for (const kind of ['setup', 'test', 'teardown'] as const) {
    const resolved = config.scripts[kind];
    const value = resolved.layer === 'team' ? resolved.value?.trim() : undefined;
    if (value) scripts[kind] = value;
  }
  if (config.scripts.run.layer === 'team') {
    const commands = Object.entries(config.scripts.run.value)
      .map(([id, command]) => [id, command.trim()] as const)
      .filter(([, command]) => command !== '');
    const run = collapseRunScripts(Object.fromEntries(commands));
    if (run !== undefined) scripts.run = run;
  }
  if (config.shellSetup.layer === 'team') {
    const value = config.shellSetup.value?.trim();
    if (value) scripts.shellSetup = value;
  }
  return scripts;
}

/**
 * The scripts a checkout runs, and so the ones its approval shows and covers:
 * an adopted checkout is the user's (plan §Phase 3 slice 6) and never runs a
 * teardown. `checkoutOrigin` is `work_item_worktrees.checkout_origin`.
 */
export function selectCheckoutScripts(chord: ChordScripts, checkoutOrigin: string): ChordScripts {
  if (checkoutOrigin !== 'adopted') return chord;
  const { teardown: _neverRuns, ...runs } = chord;
  return runs;
}

/** A Claude config file the repository supplies could not be read; the message names it. */
export class ClaudeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ClaudeConfigError';
  }
}

function parseJsonObject(text: string, source: string): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw new ClaudeConfigError(`${source} is not valid JSON: ${String(error)}`);
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new ClaudeConfigError(`${source} is not a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

async function readJsonObject(file: string): Promise<Record<string, unknown> | null> {
  if (!existsSync(file)) return null;
  return parseJsonObject(await readFile(file, 'utf8'), file);
}

function pickExecutableSettings(settings: Record<string, unknown>): Record<string, unknown> | null {
  const picked: Record<string, unknown> = {};
  for (const key of EXECUTABLE_SETTINGS_KEYS) {
    if (settings[key] !== undefined) picked[key] = settings[key];
  }
  const permissions = settings.permissions;
  if (typeof permissions === 'object' && permissions !== null) {
    const granted: Record<string, unknown> = {};
    for (const key of GRANTING_PERMISSION_KEYS) {
      const value = (permissions as Record<string, unknown>)[key];
      if (value !== undefined) granted[key] = value;
    }
    if (Object.keys(granted).length > 0) picked.permissions = granted;
  }
  return Object.keys(picked).length > 0 ? picked : null;
}

async function isTrackedByGit(checkoutPath: string, relative: string): Promise<boolean> {
  const { stdout } = await new LocalExecutionContext({ root: checkoutPath }).exec(GIT_EXECUTABLE, [
    'ls-files',
    '--',
    relative,
  ]);
  return stdout.trim() !== '';
}

function pickClaudeExecutableConfig(files: {
  settings: Record<string, unknown> | null;
  /** Only when the repository commits it. */
  localSettings: Record<string, unknown> | null;
  mcp: Record<string, unknown> | null;
  definitions: Record<string, string>;
}): ClaudeExecutableConfig {
  const result: ClaudeExecutableConfig = {};
  const pickedSettings = files.settings && pickExecutableSettings(files.settings);
  if (pickedSettings) result.settings = pickedSettings;
  const pickedLocal = files.localSettings && pickExecutableSettings(files.localSettings);
  if (pickedLocal) result.localSettings = pickedLocal;
  const servers = files.mcp?.mcpServers;
  if (typeof servers === 'object' && servers !== null && Object.keys(servers).length > 0) {
    result.mcpServers = servers as Record<string, unknown>;
  }
  if (Object.keys(files.definitions).length > 0) result.definitions = files.definitions;
  return result;
}

const LOCAL_SETTINGS = '.claude/settings.local.json';

/** The Claude config in `checkoutPath` that runs code. Throws on a file it cannot parse. */
export async function readClaudeExecutableConfig(
  checkoutPath: string
): Promise<ClaudeExecutableConfig> {
  const local = await readJsonObject(path.join(checkoutPath, LOCAL_SETTINGS));
  return pickClaudeExecutableConfig({
    settings: await readJsonObject(path.join(checkoutPath, '.claude', 'settings.json')),
    localSettings: local && (await isTrackedByGit(checkoutPath, LOCAL_SETTINGS)) ? local : null,
    mcp: await readJsonObject(path.join(checkoutPath, '.mcp.json')),
    definitions: await readDefinitionCode(checkoutPath),
  });
}

/**
 * The Claude config that runs code as committed at `ref` — what a new lane
 * checked out from `ref` would have. Throws on a file it cannot parse.
 */
export async function readClaudeExecutableConfigAtRef(
  repoPath: string,
  ref: string
): Promise<ClaudeExecutableConfig> {
  const git = new LocalExecutionContext({ root: repoPath });
  const readAtRef = async (relative: string): Promise<Record<string, unknown> | null> => {
    const { stdout: entry } = await git.exec(GIT_EXECUTABLE, ['ls-tree', ref, '--', relative]);
    if (!entry.trim()) return null;
    const { stdout } = await git.exec(GIT_EXECUTABLE, ['show', `${ref}:${relative}`]);
    return parseJsonObject(stdout, `${relative} at ${ref}`);
  };
  return pickClaudeExecutableConfig({
    settings: await readAtRef('.claude/settings.json'),
    // Anything in a commit is the repository's.
    localSettings: await readAtRef(LOCAL_SETTINGS),
    mcp: await readAtRef('.mcp.json'),
    definitions: await readDefinitionCodeAtRef(repoPath, ref),
  });
}

/** JSON with object keys sorted at every level, so equal content hashes equally. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (typeof value === 'object' && value !== null) {
    const entries = Object.keys(value)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`
      );
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Whether an approval of `approved` covers `bundle`: every script `bundle`
 * runs is one `approved` has, with the same command (run scripts per id; a
 * string `run` is id `default`), and the Claude config is the same. Fewer
 * scripts — the user's own one replacing the team's, an adopted checkout's
 * missing teardown — is covered; anything new or changed is not.
 */
export function isBundleCoveredBy(approved: BundleContent, bundle: BundleContent): boolean {
  if (canonicalJson(approved.claude) !== canonicalJson(bundle.claude)) return false;
  const approvedScripts = approved.chord as Record<string, unknown>;
  for (const [kind, command] of Object.entries(bundle.chord as Record<string, unknown>)) {
    if (kind !== 'run') {
      if (approvedScripts[kind] !== command) return false;
      continue;
    }
    const approvedRun = expandRunScripts(approved.chord.run);
    for (const [id, runCommand] of Object.entries(expandRunScripts(bundle.chord.run))) {
      if (!Object.hasOwn(approvedRun, id) || approvedRun[id] !== runCommand) return false;
    }
  }
  return true;
}

/** The bundle to approve, or null when the repository supplies nothing that runs. */
export function buildExecutableBundle(
  chord: ChordScripts,
  claude: ClaudeExecutableConfig
): ExecutableBundle | null {
  if (Object.keys(chord).length === 0 && Object.keys(claude).length === 0) return null;
  const content: BundleContent = { chord, claude };
  return { hash: createHash('sha256').update(canonicalJson(content)).digest('hex'), content };
}
