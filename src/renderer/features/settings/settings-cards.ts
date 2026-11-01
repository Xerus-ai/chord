/**
 * The single source of truth for what settings cards exist and where they live.
 *
 * `SettingsPage` renders sections by filtering this list, and its component map
 * is keyed by `SettingsCardId` — so a card cannot be rendered without an entry
 * here, and an entry here without a component fails the type check. Completeness
 * is structural rather than something a test has to notice after the fact.
 *
 * Metadata only: no JSX, no React import. That keeps this module loadable from
 * the Node test project, which matches `src/**\/*.test.ts` and cannot render
 * components.
 *
 * `keywords` is unused today. It is the index that a later settings search
 * reads, and it is filled in now because the moment to write down what a card
 * is called in a user's head is while the card is being placed, not a quarter
 * later when someone tries to retrofit search over twenty of them.
 */

import {
  CARD_FALLBACK_LABELS,
  type SettingsCardId,
} from '@renderer/features/settings/settings-card-ids';

export type SettingsTabId =
  | 'general'
  | 'clis-models'
  | 'artifacts'
  | 'integrations'
  | 'repository'
  | 'git'
  | 'interface'
  | 'sharing'
  | 'team'
  | 'rules'
  | 'skills'
  | 'mcp'
  | 'docs';

export type SettingsGroupId = 'you' | 'agents' | 'workspace' | 'connections';

export interface SettingsTabMeta {
  id: SettingsTabId;
  label: string;
  group: SettingsGroupId;
}

/** Sidebar order: groups in this order, tabs in this order within each. */
export const SETTINGS_GROUPS: readonly { id: SettingsGroupId; label: string }[] = [
  { id: 'you', label: 'You' },
  { id: 'agents', label: 'Agents' },
  { id: 'workspace', label: 'Workspace' },
  { id: 'connections', label: 'Connections' },
];

export const SETTINGS_TABS: readonly SettingsTabMeta[] = [
  { id: 'general', label: 'General', group: 'you' },
  { id: 'interface', label: 'Interface', group: 'you' },
  { id: 'sharing', label: 'Sharing', group: 'you' },
  { id: 'clis-models', label: 'Agents & models', group: 'agents' },
  { id: 'artifacts', label: 'Artifacts', group: 'agents' },
  { id: 'skills', label: 'Skills', group: 'agents' },
  { id: 'mcp', label: 'MCP Servers', group: 'agents' },
  { id: 'repository', label: 'Repository', group: 'workspace' },
  { id: 'git', label: 'Git & worktrees', group: 'workspace' },
  { id: 'team', label: 'Team', group: 'workspace' },
  { id: 'rules', label: 'Rules', group: 'workspace' },
  { id: 'integrations', label: 'Integrations', group: 'connections' },
];

/**
 * Tabs that existed in shipped builds and no longer do. A restored navigation
 * snapshot can still name one — `viewParamsStore.settings.tab` is persisted
 * across upgrades — and an unresolved id renders a settings pane with no
 * heading and no cards, which reads as the app breaking rather than as a
 * setting having moved. Account's cards live in General now, so that is where
 * an old pointer resolves.
 */
const RETIRED_SETTINGS_TABS: Record<string, SettingsTabId> = {
  account: 'general',
};

const LIVE_TAB_IDS = new Set<string>([...SETTINGS_TABS.map((tab) => tab.id), 'docs']);

/**
 * Resolves a persisted or externally supplied tab id onto a tab that exists.
 * Unknown ids fall back to General rather than rendering an empty pane.
 */
export function resolveSettingsTab(tab: string | undefined): SettingsTabId {
  if (tab && LIVE_TAB_IDS.has(tab)) return tab as SettingsTabId;
  if (tab && tab in RETIRED_SETTINGS_TABS) return RETIRED_SETTINGS_TABS[tab];
  return 'general';
}

export interface SettingsCardMeta {
  id: SettingsCardId;
  tab: SettingsTabId;
  /** Section heading. Omitted only for cards that are a whole management view. */
  title?: string;
  /**
   * Rendered bare instead of inside the section band. For views that own a
   * toolbar and a grid of their own cards (Skills, MCP, Team, Integrations),
   * where a second container around them would nest box in box.
   */
  unbanded?: true;
  /**
   * Terms a user might search for to reach this card, beyond the words already
   * in `title`. Product names and the vocabulary of the problem, not synonyms
   * of the heading.
   */
  keywords: readonly string[];
}

/** Order within a tab is render order. */
export const SETTINGS_CARDS: readonly SettingsCardMeta[] = [
  // General — Account folded in; notifications moved to Interface; worktree
  // cards moved to Git & worktrees (devstation-tuz6): they are a workspace
  // concern and the per-repository override lives under Workspace too.
  {
    id: 'account',
    tab: 'general',
    title: 'Account',
    keywords: ['account', 'sign out', 'log out', 'profile', 'email'],
  },
  {
    id: 'telemetry',
    tab: 'general',
    title: 'Privacy',
    keywords: ['telemetry', 'analytics', 'privacy', 'tracking'],
  },
  {
    id: 'updates',
    tab: 'general',
    title: 'Updates',
    keywords: ['update', 'version', 'release', 'upgrade'],
  },

  // Agents
  {
    id: 'default-agent',
    tab: 'clis-models',
    keywords: ['agent', 'model', 'default', 'claude', 'codex'],
  },
  {
    id: 'agent-launch',
    tab: 'clis-models',
    keywords: ['open agents in', 'terminal', 'chat', 'cli', 'tui', 'launch', 'new tab', '+ menu'],
  },
  {
    id: 'default-permission-mode',
    tab: 'clis-models',
    keywords: ['permission', 'mode', 'default', 'plan', 'auto', 'accept edits', 'full access'],
  },
  {
    id: 'cli-agents',
    tab: 'clis-models',
    title: 'CLI agents',
    unbanded: true,
    keywords: ['cli', 'agent', 'binary', 'path', 'claude', 'codex', 'gemini'],
  },

  // Artifacts — the delete confirmation lives on this card with the Delete
  // action it guards (P6).
  {
    id: 'artifacts',
    tab: 'artifacts',
    title: 'Artifacts',
    keywords: [
      'artifact',
      'publish',
      'document',
      'plan',
      'report',
      'prototype',
      'agent',
      'delete',
      'confirm',
    ],
  },
  {
    id: 'preferred-format',
    tab: 'artifacts',
    title: 'Preferred format',
    keywords: ['format', 'markdown', 'mdx', 'html', 'web page', 'prototype', 'react', 'document'],
  },
  {
    id: 'publishing',
    tab: 'artifacts',
    title: 'Publishing',
    keywords: ['confluence', 'atlassian', 'publish', 'space', 'page', 'wiki', 'export'],
  },

  // Integrations
  {
    id: 'integrations',
    tab: 'integrations',
    title: 'Connected services',
    unbanded: true,
    keywords: ['github', 'linear', 'jira', 'connect', 'oauth', 'token'],
  },
  {
    id: 'team-pulse',
    tab: 'integrations',
    title: 'Team Pulse',
    // The card that answers "who pays for this?" — so the billing vocabulary
    // has to reach it, not just the feature name.
    keywords: [
      'openrouter',
      'api key',
      'billing',
      'cost',
      'model',
      'summary',
      'pulse',
      'teammate activity',
    ],
  },

  // Skills / MCP
  {
    id: 'skills',
    tab: 'skills',
    unbanded: true,
    keywords: ['skill', 'module', 'extend', 'plugin'],
  },
  {
    id: 'mcp',
    tab: 'mcp',
    unbanded: true,
    keywords: ['mcp', 'server', 'tool', 'context', 'protocol'],
  },

  // Repository
  {
    id: 'repositories',
    tab: 'repository',
    title: 'Repositories',
    unbanded: true,
    keywords: ['repo', 'repository', 'clone', 'add project'],
  },

  // Git — how Chord names and handles branches, for every repository.
  {
    id: 'branch-prefix',
    tab: 'git',
    title: 'Branch prefix',
    keywords: ['branch', 'prefix', 'naming', 'username', 'github', 'gitignore'],
  },
  {
    id: 'source-control',
    tab: 'git',
    title: 'Source control',
    keywords: ['compare', 'base', 'upstream', 'diff', 'changes', 'staged', 'untracked', 'order'],
  },
  {
    id: 'git-ai',
    tab: 'git',
    title: 'AI',
    keywords: ['generate', 'commit message', 'pull request', 'template', 'draft', 'agent', 'model'],
  },
  {
    id: 'worktree-root',
    tab: 'git',
    title: 'Worktree folder',
    keywords: ['worktree', 'checkout', 'lane', 'folder', 'directory', 'disk', 'path'],
  },
  {
    id: 'worktree-sources',
    tab: 'git',
    title: 'Worktree sources',
    keywords: ['worktree', 'claude code', 'adopt', 'hidden', 'review', 'external', 'checkout'],
  },

  // Interface
  {
    id: 'theme',
    tab: 'interface',
    title: 'Color mode',
    keywords: ['theme', 'dark', 'light', 'appearance', 'color'],
  },
  {
    id: 'terminal',
    tab: 'interface',
    title: 'Terminal',
    keywords: ['terminal', 'font', 'copy', 'shell'],
  },
  {
    id: 'keyboard',
    tab: 'interface',
    title: 'Keyboard shortcuts',
    keywords: ['keyboard', 'shortcut', 'hotkey', 'binding'],
  },
  {
    id: 'hidden-tools',
    tab: 'interface',
    title: 'Tools',
    keywords: ['tools', 'hide', 'toolbar', 'visibility'],
  },
  {
    id: 'notifications',
    tab: 'interface',
    title: 'Notifications',
    keywords: ['notifications', 'alerts', 'sound', 'badge'],
  },
  {
    id: 'notification-types',
    tab: 'interface',
    title: 'Notification types',
    keywords: ['notifications', 'alerts', 'per-event', 'mute'],
  },

  // Team
  { id: 'team', tab: 'team', unbanded: true, keywords: ['team', 'members', 'invite', 'sharing'] },
  {
    id: 'team-sharing',
    tab: 'team',
    title: 'Sharing',
    keywords: ['public link', 'anyone with the link', 'confluence', 'publish', 'owner', 'policy'],
  },

  // Sharing (You) — P6: private until shared.
  {
    id: 'default-access',
    tab: 'sharing',
    title: 'Default access',
    keywords: ['private', 'only you', 'team', 'new work item', 'default', 'visibility'],
  },
  {
    id: 'shared-by-me',
    tab: 'sharing',
    title: 'Shared by you',
    keywords: ['shared', 'revoke', 'stop sharing', 'copy link', 'public link', 'access'],
  },

  // Rules
  {
    id: 'quality-gates',
    tab: 'rules',
    title: 'Quality gates',
    keywords: ['quality', 'gate', 'review', 'merge', 'guardrail'],
  },
  // Same class of guardrail as the gates above, so it sits with them rather
  // than with the per-user agent preferences it used to share a tab with.
  {
    id: 'review-prompt',
    tab: 'rules',
    title: 'Review Prompt',
    keywords: ['review', 'prompt', 'code review', 'guardrail'],
  },
];

export function settingsCardsForTab(tab: SettingsTabId): readonly SettingsCardMeta[] {
  return SETTINGS_CARDS.filter((card) => card.tab === tab);
}

const TAB_LABELS: ReadonlyMap<SettingsTabId, string> = new Map(
  SETTINGS_TABS.map((tab) => [tab.id, tab.label])
);

const GROUP_LABELS: ReadonlyMap<SettingsGroupId, string> = new Map(
  SETTINGS_GROUPS.map((group) => [group.id, group.label])
);

export interface SettingsSearchHit {
  card: SettingsCardMeta;
  /** "Group › Tab", for showing where a hit lives without opening it. */
  breadcrumb: string;
  /** What the query matched, so the UI can show why a hit is a hit. */
  label: string;
}

export function settingsCardLabel(card: SettingsCardMeta): string {
  return card.title ?? CARD_FALLBACK_LABELS[card.id];
}

export function settingsCardBreadcrumb(card: SettingsCardMeta): string {
  const tab = SETTINGS_TABS.find((entry) => entry.id === card.tab);
  const group = tab ? GROUP_LABELS.get(tab.group) : undefined;
  const tabLabel = TAB_LABELS.get(card.tab) ?? card.tab;
  return group ? `${group} › ${tabLabel}` : tabLabel;
}

/**
 * Ranked card search over titles, tab labels and keywords.
 *
 * Ranking is deliberately coarse — a title match beats a keyword match beats a
 * tab-label match — because the corpus is twenty cards. Anything cleverer would
 * be tuning against a set small enough to read.
 */
export function searchSettingsCards(query: string): SettingsSearchHit[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const scored: Array<{ hit: SettingsSearchHit; score: number }> = [];

  for (const card of SETTINGS_CARDS) {
    const label = settingsCardLabel(card);
    const tabLabel = TAB_LABELS.get(card.tab) ?? '';

    let score = 0;
    const lowerLabel = label.toLowerCase();
    if (lowerLabel.startsWith(needle)) score = 100;
    else if (lowerLabel.includes(needle)) score = 80;
    else if (card.keywords.some((keyword) => keyword.startsWith(needle))) score = 60;
    else if (card.keywords.some((keyword) => keyword.includes(needle))) score = 40;
    else if (tabLabel.toLowerCase().includes(needle)) score = 20;

    if (score > 0) {
      scored.push({
        hit: { card, breadcrumb: settingsCardBreadcrumb(card), label },
        score,
      });
    }
  }

  return scored
    .sort((a, b) => b.score - a.score || a.hit.label.localeCompare(b.hit.label))
    .map((entry) => entry.hit);
}

const CARD_IDS = new Set<string>(SETTINGS_CARDS.map((card) => card.id));

/** Validates an externally supplied card anchor before it is trusted. */
export function resolveSettingsCardId(cardId: string | undefined): SettingsCardId | undefined {
  return cardId && CARD_IDS.has(cardId) ? (cardId as SettingsCardId) : undefined;
}

/** The tab a card anchor should open. */
export function tabForSettingsCard(cardId: SettingsCardId): SettingsTabId {
  const card = SETTINGS_CARDS.find((entry) => entry.id === cardId);
  if (!card) throw new Error(`Unknown settings card id: ${cardId}`);
  return card.tab;
}

/** DOM id for a card's section, shared by the renderer and anchor scrolling. */
export function settingsCardDomId(cardId: SettingsCardId): string {
  return `settings-card-${cardId}`;
}
