import { formatClaudeDefinitions } from '@shared/claude-definitions-text';
import { DEFAULT_RUN_SCRIPT_ID, formatRunScriptTitle, pairRunScripts } from '@shared/run-scripts';
import type { BundleContent } from '@main/core/workspaces/executable-bundle';

/**
 * The rows of Repo › Trust: each thing a repository can run, what a new lane
 * would run now, and what Always trust approved — so a change since approval
 * is visible, including an approved item that no longer runs.
 */

export interface TrustItem {
  key: string;
  title: string;
  when: string;
  /** Undefined when it no longer runs. */
  now: string | undefined;
  /** What Always trust approved; undefined when nothing to compare or not approved. */
  before: string | undefined;
  changed: boolean;
}

interface ItemSpec {
  key: string;
  title: string;
  when: string;
  read: (bundle: BundleContent) => unknown;
}

/** The items listed before the run scripts. */
const BEFORE_RUN: readonly ItemSpec[] = [
  {
    key: 'setup',
    title: 'Setup script',
    when: 'Runs in each new lane.',
    read: (b) => b.chord.setup,
  },
  {
    key: 'shellSetup',
    title: 'Shell setup',
    when: 'Runs before each agent and terminal starts (not on Windows).',
    read: (b) => b.chord.shellSetup,
  },
];

/** The items listed after the run scripts. */
const AFTER_RUN: readonly ItemSpec[] = [
  {
    key: 'test',
    title: 'Test script',
    when: 'Runs when you press Test.',
    read: (b) => b.chord.test,
  },
  {
    key: 'teardown',
    title: 'Teardown script',
    when: 'Runs when a lane is removed.',
    read: (b) => b.chord.teardown,
  },
  {
    key: 'settings',
    title: 'Claude hooks and settings',
    when: 'From .claude/settings.json.',
    read: (b) => b.claude.settings,
  },
  {
    key: 'localSettings',
    title: 'Claude local settings (committed)',
    when: 'From .claude/settings.local.json, which this repository commits.',
    read: (b) => b.claude.localSettings,
  },
  {
    key: 'mcpServers',
    title: 'MCP servers',
    when: 'From .mcp.json: started by Claude Code.',
    read: (b) => b.claude.mcpServers,
  },
  {
    key: 'definitions',
    title: 'Claude skills, agents and commands',
    when: 'From .claude/skills, agents and commands: header hooks, servers and tool grants, and ! shell lines.',
    read: (b) => b.claude.definitions && formatClaudeDefinitions(b.claude.definitions),
  },
];

function asText(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
}

function compareItem(
  item: Pick<TrustItem, 'key' | 'title' | 'when'>,
  now: string | undefined,
  before: string | undefined,
  compare: boolean
): TrustItem | null {
  if (now === undefined && before === undefined) return null;
  const changed = compare && now !== before;
  return { ...item, now, before: changed ? before : undefined, changed };
}

function listSpecItems(
  specs: readonly ItemSpec[],
  current: BundleContent | null,
  approved: BundleContent | null
): TrustItem[] {
  return specs.flatMap((spec) => {
    const item = compareItem(
      spec,
      current ? asText(spec.read(current)) : undefined,
      approved ? asText(spec.read(approved)) : undefined,
      approved !== null
    );
    return item ? [item] : [];
  });
}

/** One item per run script, id by id: `run` for the default one, `run.<id>` for a named one. */
function listRunItems(current: BundleContent | null, approved: BundleContent | null): TrustItem[] {
  return pairRunScripts(current?.chord.run, approved?.chord.run).flatMap((pair) => {
    const item = compareItem(
      {
        key: pair.id === DEFAULT_RUN_SCRIPT_ID ? 'run' : `run.${pair.id}`,
        title: formatRunScriptTitle(pair.id),
        when: 'Runs when you start it.',
      },
      pair.now,
      pair.before,
      approved !== null
    );
    return item ? [item] : [];
  });
}

export function listTrustItems(
  current: BundleContent | null,
  approved: BundleContent | null
): TrustItem[] {
  return [
    ...listSpecItems(BEFORE_RUN, current, approved),
    ...listRunItems(current, approved),
    ...listSpecItems(AFTER_RUN, current, approved),
  ];
}
