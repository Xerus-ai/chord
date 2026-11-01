import type { AgentProviderId } from './agent-provider-registry';

export interface AgentModelOption {
  id: string;
  label: string;
}

/**
 * Per-provider model selection facts for agents launched by CLI flag: which
 * models the composer offers and how the choice reaches the CLI at launch.
 * Claude and Codex are not in this table — their catalogs are asked of the
 * agent itself (agent-catalog/), and their transports take the selection as
 * a protocol option rather than a CLI flag.
 *
 * Only VERIFIED mechanisms belong here — a flag the CLI silently ignores
 * makes the composer pill lie. Providers absent from this table simply show
 * no model/effort pill and run on their own default:
 * - droid: the interactive TUI has no --model flag (only `droid exec` does);
 *   model changes happen via /model inside the session.
 * - qwen/copilot/opencode/goose: model selection under their ACP modes is
 *   undocumented or explicitly unsupported (opencode acp takes no --model;
 *   goose only honors GOOSE_MODEL env, which the ACP launch does not inject).
 */
export interface ProviderModelConfig {
  /** Composer choices; omitted when only effort is configurable. */
  models?: readonly AgentModelOption[];
  /**
   * Args emitted for a model selection, with '{model}' replaced by the id.
   * Appended to the launch argv (PTY command or ACP bridge spawn).
   */
  modelArgs?: readonly string[];
  /**
   * Args emitted for a reasoning-effort selection, with '{effort}' replaced
   * by the chosen level. Absent when the provider has no effort setting.
   */
  effortArgs?: readonly string[];
}

const PROVIDER_MODELS: Partial<Record<AgentProviderId, ProviderModelConfig>> = {
  // PTY chat; `-m` is a global flag and coexists with --resume.
  gemini: {
    models: [
      { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro' },
      { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
      { id: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
      { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    ],
    modelArgs: ['-m', '{model}'],
  },
  // PTY chat; --model is a global flag. Slugs from cursor.com/docs/models —
  // availability is account-dependent, so an unrecognized slug fails loudly
  // in the session rather than silently.
  cursor: {
    models: [
      { id: 'composer-2.5', label: 'Composer 2.5' },
      { id: 'claude-sonnet-5', label: 'Sonnet 5' },
      { id: 'claude-opus-5', label: 'Opus 5' },
      { id: 'gpt-5.5', label: 'GPT-5.5' },
      { id: 'gpt-5.3-codex', label: 'GPT-5.3 Codex' },
      { id: 'gemini-3-pro', label: 'Gemini 3 Pro' },
    ],
    modelArgs: ['--model', '{model}'],
  },
  // --reasoning-effort is documented as ACP-server-compatible (low|medium|
  // high|xhigh|max); --model under --acp is not documented, so no model list.
  copilot: {
    effortArgs: ['--reasoning-effort', '{effort}'],
  },
};

/**
 * The static controls for a provider launched by CLI flag, or undefined when
 * the provider has none (droid, goose…) or is catalogued another way — Claude
 * and Codex are probed (`agent-catalog/`, `codex-app-server/codex-catalog.ts`).
 */
export function getStaticProviderControls(
  providerId: AgentProviderId
): ProviderModelConfig | undefined {
  return PROVIDER_MODELS[providerId];
}

/** The composer's effort levels for a provider whose effort is a CLI flag. */
export const STATIC_EFFORT_LEVELS = ['low', 'medium', 'high', 'xhigh'] as const;

/**
 * CLI args that apply an already-resolved selection (see
 * `resolveCatalogSelection`) to a non-Claude launch. Empty when nothing is
 * selected — the CLI then runs on the provider's own default.
 */
export function buildModelArgs(
  providerId: AgentProviderId,
  selection: { model: string | null; effort: string | null }
): string[] {
  const config = PROVIDER_MODELS[providerId];
  if (!config) return [];
  const args: string[] = [];
  if (selection.model && config.modelArgs) {
    const model = selection.model;
    args.push(...config.modelArgs.map((a) => a.replace('{model}', model)));
  }
  if (selection.effort && config.effortArgs) {
    const effort = selection.effort;
    args.push(...config.effortArgs.map((a) => a.replace('{effort}', effort)));
  }
  return args;
}
