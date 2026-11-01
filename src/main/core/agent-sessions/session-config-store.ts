import {
  resolveCatalogSelection,
  type AgentControlCatalog,
  type CatalogSelection,
} from '@shared/agent-control-catalog';
import {
  deleteSessionConfig,
  loadSessionConfigs,
  saveSessionConfig,
} from './session-config-persistence';

/**
 * A chat session's own model/effort selection, overriding the work item's
 * `model`/`effort` columns for that session only: a session tab's pick is a
 * per-conversation choice, while the work item's columns stay the durable
 * default for the Room and for new sessions — so parallel sessions stop
 * restarting each other. Persisted per session (`session-config-persistence`)
 * so a resumed conversation keeps its pick across app restarts; the in-memory
 * map is loaded on first use and written through on every change.
 *
 * A field left `undefined` falls back to the work item; `model: null` is an
 * explicit "provider default" and does override, as does `effort: null`. `fast` exists only here — the
 * work item has no column for it, so a new session starts at standard speed.
 */
export type ChatSessionConfig = { model?: string | null; effort?: string | null; fast?: boolean };

export type LaunchConfig = CatalogSelection;

let configBySession: Map<string, ChatSessionConfig> | null = null;

function loadedConfigs(): Map<string, ChatSessionConfig> {
  configBySession ??= loadSessionConfigs();
  return configBySession;
}

export function getChatSessionConfig(sessionId: string): ChatSessionConfig {
  return loadedConfigs().get(sessionId) ?? {};
}

export function setChatSessionConfig(sessionId: string, patch: ChatSessionConfig): void {
  const configs = loadedConfigs();
  const next = { ...configs.get(sessionId) };
  if (patch.model !== undefined) next.model = patch.model;
  if (patch.effort !== undefined) next.effort = patch.effort;
  if (patch.fast !== undefined) next.fast = patch.fast;
  saveSessionConfig(sessionId, next);
  configs.set(sessionId, next);
}

/** Forget a session's override once the session has ended for good (`done` or deleted). */
export function clearChatSessionConfig(sessionId: string): void {
  const configs = loadedConfigs();
  if (!configs.has(sessionId)) return;
  deleteSessionConfig(sessionId);
  configs.delete(sessionId);
}

/**
 * The model/effort/fast a chat session launches with: its override, else the
 * work item's value, narrowed to what the provider's catalog can run. Both the
 * launch (session-service) and the live-session restart check
 * (deliver-to-session) must use this, or a live session restarts on every send.
 */
export function resolveChatLaunchConfig(
  catalog: AgentControlCatalog,
  item: { model: string | null; effort: string | null } | undefined,
  sessionId: string
): LaunchConfig {
  const own = getChatSessionConfig(sessionId);
  return resolveCatalogSelection(catalog, {
    model: own.model !== undefined ? own.model : item?.model,
    effort: own.effort !== undefined ? own.effort : item?.effort,
    fast: own.fast ?? false,
  });
}

/** Whether a live session's launch differs from the config it should run with. */
export function launchConfigChanged(
  launch: LaunchConfig | undefined,
  expected: LaunchConfig
): boolean {
  return (
    launch !== undefined &&
    (launch.model !== expected.model ||
      launch.effort !== expected.effort ||
      launch.fast !== expected.fast)
  );
}
