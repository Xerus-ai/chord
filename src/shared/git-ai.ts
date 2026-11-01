import z from 'zod';
import { AGENT_PROVIDER_IDS, type AgentProviderId } from './agent-provider-registry';
import { AGENT_PROVIDERS } from './agent-providers';

/**
 * Git AI (plan 2026-09-26 §Phase 3 slice 4): "Generate" in the commit field
 * and in Create PR runs the user's own agent as a one-shot, tool-less prompt.
 * No other engine (Decisions for Phase 3).
 *
 * The agents that can: Claude (through its SDK), Codex (its app-server, an
 * ephemeral thread) and every ACP agent in the registry (a session in an empty
 * temp folder, every permission denied). Terminal-only agents cannot.
 */
export const GIT_AI_AGENTS: readonly AgentProviderId[] = [
  'claude',
  'codex',
  ...AGENT_PROVIDERS.filter(
    (provider) => provider.communication === 'acp' && provider.acpConfig && provider.id !== 'claude'
  ).map((provider) => provider.id),
];

export type GitAiAgent = AgentProviderId;

/** How a one-shot reaches the agent. */
export type GitAiTransport = 'claude-sdk' | 'codex-app-server' | 'acp';

export function gitAiTransport(agent: GitAiAgent): GitAiTransport {
  if (agent === 'claude') return 'claude-sdk';
  if (agent === 'codex') return 'codex-app-server';
  if (!GIT_AI_AGENTS.includes(agent)) throw new Error(`${agent} cannot run a one-shot prompt`);
  return 'acp';
}

const gitAiAgentSchema = z
  .enum(AGENT_PROVIDER_IDS)
  .refine((id) => GIT_AI_AGENTS.includes(id), 'this agent cannot run a one-shot prompt');

export const gitAiSettingsSchema = z.object({
  agent: gitAiAgentSchema,
  /** A model id from the agent's own catalog; null = the agent's default. */
  model: z.string().min(1).nullable(),
  instructions: z.object({ commit: z.string(), pr: z.string() }),
  prDefaults: z.object({
    draft: z.boolean(),
    useTemplate: z.boolean(),
    openAfterCreate: z.boolean(),
  }),
});

export type GitAiSettings = z.infer<typeof gitAiSettingsSchema>;

/**
 * A repository's just-me override: only the fields it names apply; every
 * other field inherits from You (or the built-in default).
 */
export const gitAiOverrideSchema = z
  .object({
    agent: gitAiAgentSchema.optional(),
    model: z.string().min(1).nullable().optional(),
    instructions: z
      .object({ commit: z.string().optional(), pr: z.string().optional() })
      .strict()
      .optional(),
    prDefaults: z
      .object({
        draft: z.boolean().optional(),
        useTemplate: z.boolean().optional(),
        openAfterCreate: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export type GitAiOverride = z.infer<typeof gitAiOverrideSchema>;

export const GIT_AI_FIELDS = [
  'agent',
  'model',
  'instructions.commit',
  'instructions.pr',
  'prDefaults.draft',
  'prDefaults.useTemplate',
  'prDefaults.openAfterCreate',
] as const;

export type GitAiField = (typeof GIT_AI_FIELDS)[number];

/** Where a field's value came from: built-in, You, or this repository (just me). */
export type GitAiLayer = 'default' | 'you' | 'justMe';

export interface ResolvedGitAiSettings {
  value: GitAiSettings;
  layers: Record<GitAiField, GitAiLayer>;
}

/** A field's value in a settings object or an override (undefined = not set there). */
export function readGitAiField(source: GitAiSettings | GitAiOverride, field: GitAiField): unknown {
  const [group, key] = field.split('.') as [string, string | undefined];
  const value = (source as Record<string, unknown>)[group];
  if (key === undefined) return value;
  return (value as Record<string, unknown> | undefined)?.[key];
}

/** Whether the chosen agent can answer now, so the button can say why not. */
export type GitAiAgentStatus =
  | { state: 'ready' }
  | { state: 'not_installed'; message: string }
  | { state: 'not_signed_in'; message: string }
  /** An ACP agent that could not start a session. */
  | { state: 'unavailable'; message: string };

/** What the agent printed, bounded head and tail; never persisted or synced. */
export interface GitAiAgentOutput {
  text: string;
  omittedChars: number;
}

export type GitAiFailure =
  | { type: 'agent_not_installed'; agent: GitAiAgent; message: string }
  | {
      type: 'agent_not_signed_in';
      agent: GitAiAgent;
      message: string;
      output: GitAiAgentOutput | null;
    }
  | { type: 'agent_failed'; agent: GitAiAgent; message: string; output: GitAiAgentOutput | null }
  | { type: 'unreadable_output'; agent: GitAiAgent; message: string; output: GitAiAgentOutput }
  | { type: 'nothing_to_describe'; message: string }
  | { type: 'canceled' };

export interface GeneratedCommitMessage {
  message: string;
  agent: GitAiAgent;
  /** The diff was over the prompt budget and sent as stats plus the largest hunks. */
  inputCut: boolean;
}

export interface GeneratedPullRequest {
  title: string;
  body: string;
  agent: GitAiAgent;
  inputCut: boolean;
}

/** The repository's single PR template, path relative to the checkout. */
export interface PullRequestTemplate {
  path: string;
  text: string;
}
