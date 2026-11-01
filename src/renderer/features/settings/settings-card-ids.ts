/**
 * The vocabulary of settings cards: every card id, and the name each one goes
 * by when nothing else names it. Where a card lives and what it is searched by
 * is `settings-cards.ts`; this module only says which cards exist.
 */

export type SettingsCardId =
  | 'telemetry'
  | 'notifications'
  | 'notification-types'
  | 'updates'
  | 'account'
  | 'default-agent'
  | 'agent-launch'
  | 'default-permission-mode'
  | 'review-prompt'
  | 'cli-agents'
  | 'integrations'
  | 'team-pulse'
  | 'skills'
  | 'mcp'
  | 'repositories'
  | 'branch-prefix'
  | 'source-control'
  | 'git-ai'
  | 'worktree-root'
  | 'worktree-sources'
  | 'theme'
  | 'terminal'
  | 'keyboard'
  | 'hidden-tools'
  | 'team'
  | 'quality-gates'
  | 'artifacts'
  | 'preferred-format'
  | 'publishing'
  | 'default-access'
  | 'shared-by-me'
  | 'team-sharing';

/**
 * Fallback heading for cards that render their own title. Search cannot show a
 * blank row, and inventing display copy in the UI layer would put two sources
 * of truth for a card's name one import apart.
 */
export const CARD_FALLBACK_LABELS: Record<SettingsCardId, string> = {
  telemetry: 'Telemetry & analytics',
  notifications: 'Notifications',
  'notification-types': 'Notification types',
  updates: 'Updates',
  account: 'Account',
  'default-agent': 'Default agent',
  'agent-launch': 'Open agents in',
  'default-permission-mode': 'Default permission mode',
  'review-prompt': 'Review Prompt',
  'cli-agents': 'CLI agents',
  integrations: 'Connected services',
  'team-pulse': 'Team Pulse',
  skills: 'Skills',
  mcp: 'MCP Servers',
  repositories: 'Repositories',
  'branch-prefix': 'Branch prefix',
  'source-control': 'Source control',
  'git-ai': 'AI',
  'worktree-root': 'Worktree folder',
  'worktree-sources': 'Worktree sources',
  theme: 'Theme',
  terminal: 'Terminal',
  keyboard: 'Keyboard shortcuts',
  'hidden-tools': 'Tools',
  team: 'Team',
  'quality-gates': 'Quality gates',
  artifacts: 'Artifacts',
  'preferred-format': 'Preferred format',
  publishing: 'Publishing',
  'default-access': 'Default access',
  'shared-by-me': 'Shared by you',
  'team-sharing': 'Sharing',
};
