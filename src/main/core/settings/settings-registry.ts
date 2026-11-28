import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AppSettings, AppSettingsKey } from '@shared/app-settings';
import type { OpenInAppId } from '@shared/openInApps';
import { getDefaultLocalWorktreeDirectory } from './worktree-defaults';

export const DEFAULT_AGENT_ID = 'claude';
export const DEFAULT_REVIEW_PROMPT =
  'Review all changes in this worktree. Focus on correctness, regressions, edge cases, and missing tests. List concrete issues first, then note residual risks.';

type SettingsDefaultsMap = {
  [K in AppSettingsKey]: AppSettings[K] | (() => AppSettings[K]);
};

export const SETTINGS_DEFAULTS = {
  localProject: () => ({
    defaultProjectsDirectory: join(homedir(), 'chord', 'repositories'),
    defaultWorktreeDirectory: getDefaultLocalWorktreeDirectory(),
    branchPrefixMode: 'username' as const,
    branchPrefix: 'chord',
    branchPrefixUsername: null,
  }),
  git: {
    compareBase: 'repoDefault' as const,
    sourceControlGroupOrder: 'changes' as const,
  },
  gitAi: {
    agent: DEFAULT_AGENT_ID,
    model: null,
    instructions: { commit: '', pr: '' },
    prDefaults: { draft: false, useTemplate: true, openAfterCreate: false },
  },
  // A checkout of unknown origin starts hidden; Claude Code's own are listed.
  worktreeSources: {
    claudeCode: 'show' as const,
    other: 'hide' as const,
  },
  tasks: {
    autoTrustWorktrees: true,
  },
  agentLaunch: {
    openAgentsIn: 'chat' as const,
  },
  agentDefaultPermissionModes: {},
  notifications: {
    enabled: true,
    sound: true,
    osNotifications: true,
    soundFocusMode: 'always' as const,
  },
  terminal: {
    autoCopyOnSelection: false,
  },
  theme: null,
  defaultAgent: DEFAULT_AGENT_ID,
  reviewPrompt: DEFAULT_REVIEW_PROMPT,
  keyboard: {},
  openIn: {
    default: 'terminal' as const,
    hidden: [] as OpenInAppId[],
  },
  interface: {
    taskHoverAction: 'delete' as const,
    autoRightSidebarBehavior: false,
  },
  browserPreview: {
    enabled: true,
  },
  teamPulse: {
    model: 'google/gemini-2.0-flash-001',
  },
  qualityGates: {
    requireReviewBeforeMerge: false,
    requirePassingTests: false,
    requirePlanningDoc: false,
    requireHumanApproval: false,
  },
  artifacts: {
    enabled: true,
    preferredFormat: 'best-fit' as const,
    confluenceDefaultSpaceKey: null,
    confluenceUpdateMode: 'ask' as const,
    confirmDeleteShared: true,
  },
  sharing: {
    defaultWorkItemAccess: 'invited' as const,
  },
  desktopCompatibility: {
    requiredMinimum: null,
  },
  featureFlags: {
    served: null,
  },
} satisfies SettingsDefaultsMap;

export function getDefaultForKey<K extends AppSettingsKey>(key: K): AppSettings[K] {
  const d = SETTINGS_DEFAULTS[key];
  return (typeof d === 'function' ? (d as () => AppSettings[K])() : d) as AppSettings[K];
}

/**
 * Keys main keeps for itself, not preferences: the sync server's last word on this app's version
 * and on the feature flags. The renderer's settings RPC may not write them, and a stored row of
 * either is validated on load (devstation-mg6u.98).
 */
export const INTERNAL_SETTINGS_KEYS: ReadonlySet<AppSettingsKey> = new Set<AppSettingsKey>([
  'desktopCompatibility',
  'featureFlags',
]);
