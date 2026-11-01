import z from 'zod';
import { AGENT_PROVIDER_IDS } from '@shared/agent-provider-registry';
import { AGENT_PROVIDERS } from '@shared/agent-providers';
import { PREFERRED_ARTIFACT_FORMATS } from '@shared/artifact-formats';
import { CONFLUENCE_UPDATE_MODES } from '@shared/confluence';
import { gitAiSettingsSchema } from '@shared/git-ai';
import { COMPARE_BASE_MODES, SOURCE_CONTROL_GROUP_ORDERS } from '@shared/git-settings';
import { openInAppIdSchema } from '@shared/openInApps';
import { WORKTREE_SOURCE_VISIBILITIES } from '@shared/worktree-sources';
import { DEFAULT_AGENT_ID, DEFAULT_REVIEW_PROMPT } from './settings-registry';

export const localProjectSettingsSchema = z.object({
  defaultProjectsDirectory: z.string(),
  defaultWorktreeDirectory: z.string(),
  /**
   * Settings › Git: what a new chord-named branch starts with — the signed-in
   * user's GitHub login, the typed `branchPrefix`, or nothing.
   */
  branchPrefixMode: z.enum(['username', 'custom', 'none']),
  /** The prefix in `custom` mode. */
  branchPrefix: z.string(),
  /** `username` mode: the login, looked up once from GitHub and stored. */
  branchPrefixUsername: z.string().min(1).nullable(),
});

/** Settings › Git: compare base and Changes group order (`@shared/git-settings`). */
export const gitSettingsSchema = z.object({
  compareBase: z.enum(COMPARE_BASE_MODES),
  sourceControlGroupOrder: z.enum(SOURCE_CONTROL_GROUP_ORDERS),
});

/**
 * Settings › General › Worktree sources: which checkouts made outside Chord are
 * listed under their repository with Adopt (`show`) and which are only
 * counted in "Review N worktrees" (`hide`), by where they came from.
 */
export const worktreeSourcesSettingsSchema = z.object({
  claudeCode: z.enum(WORKTREE_SOURCE_VISIBILITIES),
  other: z.enum(WORKTREE_SOURCE_VISIBILITIES),
});

export const notificationSettingsSchema = z.object({
  enabled: z.boolean(),
  sound: z.boolean(),
  osNotifications: z.boolean(),
  soundFocusMode: z.enum(['always', 'unfocused']),
});

export const taskSettingsSchema = z.object({
  autoTrustWorktrees: z.boolean(),
});

/**
 * Settings › Agents & models › Open agents in: what an agent row in a work
 * item's `+` menu opens: a chat, or the agent's own CLI in a terminal.
 */
export const agentLaunchSettingsSchema = z.object({
  openAgentsIn: z.enum(['chat', 'terminal']),
});

/**
 * Settings › Agents & models › Default permission mode: per agent, the mode
 * id (from that agent's catalog) a session starts in until one is picked.
 */
export const agentDefaultPermissionModesSchema = z
  .partialRecord(z.enum(AGENT_PROVIDER_IDS), z.string().min(1))
  .default({});

export const terminalSettingsSchema = z.object({
  fontFamily: z.string().optional(),
  autoCopyOnSelection: z.boolean(),
});

export const themeSchema = z
  .enum(['chord-light', 'chord-dark'])
  .nullable()
  .catch(null)
  .optional()
  .default(null);

export const defaultAgentSchema = z.optional(z.enum(AGENT_PROVIDER_IDS)).default(DEFAULT_AGENT_ID);

export const reviewPromptSchema = z.string().default(DEFAULT_REVIEW_PROMPT);

export const keyboardSettingsSchema = z
  .optional(
    z.object({
      commandPalette: z.string().nullable().optional(),
      fileFinder: z.string().nullable().optional(),
      settings: z.string().nullable().optional(),
      toggleLeftSidebar: z.string().nullable().optional(),
      toggleRightSidebar: z.string().nullable().optional(),
      toggleTheme: z.string().nullable().optional(),
      closeModal: z.string().nullable().optional(),
      nextWorkItem: z.string().nullable().optional(),
      prevWorkItem: z.string().nullable().optional(),
      newWorkItem: z.string().nullable().optional(),
      newRepository: z.string().nullable().optional(),
      openInEditor: z.string().nullable().optional(),
      taskViewAgents: z.string().nullable().optional(),
      taskViewDiff: z.string().nullable().optional(),
      taskViewEditor: z.string().nullable().optional(),
      tabNext: z.string().nullable().optional(),
      tabPrev: z.string().nullable().optional(),
      tabClose: z.string().nullable().optional(),
      newConversation: z.string().nullable().optional(),
      newTerminal: z.string().nullable().optional(),
      cycleEffort: z.string().nullable().optional(),
      focusChat: z.string().nullable().optional(),
      confirm: z.string().nullable().optional(),
    })
  )
  .default({});

export const providerCustomConfigEntrySchema = z.object({
  cli: z.string().optional(),
  resumeFlag: z.string().optional(),
  defaultArgs: z.array(z.string()).optional(),
  autoApproveFlag: z.string().optional(),
  initialPromptFlag: z.string().optional(),
  sessionIdFlag: z.string().optional(),
  extraArgs: z.string().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export const providerConfigDefaults = Object.fromEntries(
  AGENT_PROVIDERS.filter(
    (p) => p.cli || p.resumeFlag || p.autoApproveFlag || p.initialPromptFlag || p.defaultArgs
  ).map((p) => [
    p.id,
    {
      ...(p.cli ? { cli: p.cli } : {}),
      ...(p.resumeFlag ? { resumeFlag: p.resumeFlag } : {}),
      ...(p.autoApproveFlag ? { autoApproveFlag: p.autoApproveFlag } : {}),
      ...(p.initialPromptFlag !== undefined ? { initialPromptFlag: p.initialPromptFlag } : {}),
      ...(p.defaultArgs ? { defaultArgs: p.defaultArgs } : {}),
      ...(p.sessionIdFlag ? { sessionIdFlag: p.sessionIdFlag } : {}),
    },
  ])
);

export const interfaceSettingsSchema = z.object({
  taskHoverAction: z.enum(['delete', 'archive']),
  autoRightSidebarBehavior: z.boolean(),
});

export const browserPreviewSettingsSchema = z.object({ enabled: z.boolean() });

export const teamPulseSettingsSchema = z.object({
  model: z.string(),
});

/**
 * Team guardrails the user opts into. Chord records the preference; no part of the
 * pipeline blocks a merge on these yet, so the UI labels them as not-yet-enforced.
 */
export const qualityGatesSettingsSchema = z.object({
  requireReviewBeforeMerge: z.boolean(),
  requirePassingTests: z.boolean(),
  requirePlanningDoc: z.boolean(),
  requireHumanApproval: z.boolean(),
});

export const openInSettingsSchema = z.object({
  default: openInAppIdSchema,
  hidden: z.array(openInAppIdSchema),
});

/**
 * Settings › Agents › Artifacts (plan 2026-09-23 §3). `enabled` off means the
 * `chord` MCP server is not injected, the built-in Claude Code Artifact tool is
 * left to the user's own Claude settings, and no unpublished-document chips
 * appear. Nothing already published is touched.
 */
export const artifactsSettingsSchema = z.object({
  enabled: z.boolean(),
  preferredFormat: z.enum(PREFERRED_ARTIFACT_FORMATS),
  /** Publishing card (P5): the space a first publish goes to; null until chosen. */
  confluenceDefaultSpaceKey: z.string().min(1).nullable(),
  /** Publishing card (P5): what happens to a published page when its artifact changes. */
  confluenceUpdateMode: z.enum(CONFLUENCE_UPDATE_MODES),
  /** P6: confirm before deleting an artifact others can open (its link breaks for them). */
  confirmDeleteShared: z.boolean(),
});

/**
 * Settings › You › Sharing (P6). Everything starts private ("Only you"); this
 * can make NEW work items start open to the team, read-only. Applied when the
 * work item is first synced to the cloud; existing items are never changed.
 */
export const sharingSettingsSchema = z.object({
  defaultWorkItemAccess: z.enum(['invited', 'team_view']),
});

export const APP_SETTINGS_SCHEMA_MAP = {
  localProject: localProjectSettingsSchema,
  git: gitSettingsSchema,
  gitAi: gitAiSettingsSchema,
  worktreeSources: worktreeSourcesSettingsSchema,
  tasks: taskSettingsSchema,
  agentLaunch: agentLaunchSettingsSchema,
  agentDefaultPermissionModes: agentDefaultPermissionModesSchema,
  defaultAgent: defaultAgentSchema,
  reviewPrompt: reviewPromptSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
  teamPulse: teamPulseSettingsSchema,
  qualityGates: qualityGatesSettingsSchema,
  artifacts: artifactsSettingsSchema,
  sharing: sharingSettingsSchema,
} as const;

export const appSettingsSchema = z.object({
  localProject: localProjectSettingsSchema,
  git: gitSettingsSchema,
  gitAi: gitAiSettingsSchema,
  worktreeSources: worktreeSourcesSettingsSchema,
  tasks: taskSettingsSchema,
  agentLaunch: agentLaunchSettingsSchema,
  agentDefaultPermissionModes: agentDefaultPermissionModesSchema,
  defaultAgent: defaultAgentSchema,
  reviewPrompt: reviewPromptSchema,
  keyboard: keyboardSettingsSchema,
  notifications: notificationSettingsSchema,
  theme: themeSchema,
  openIn: openInSettingsSchema,
  interface: interfaceSettingsSchema,
  terminal: terminalSettingsSchema,
  browserPreview: browserPreviewSettingsSchema,
  teamPulse: teamPulseSettingsSchema,
  qualityGates: qualityGatesSettingsSchema,
  artifacts: artifactsSettingsSchema,
  sharing: sharingSettingsSchema,
});
