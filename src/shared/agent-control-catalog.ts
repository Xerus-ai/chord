import { getStaticProviderControls, STATIC_EFFORT_LEVELS } from './agent-models';
import type { AgentProviderId } from './agent-provider-registry';
import {
  claudePermissionModes,
  modesForModel,
  type PermissionModeOption,
} from './permission-modes';

/**
 * What the composer can control for one agent — models, their effort levels
 * and fast-mode support, and its permission modes. Every source
 * (the Claude CLI probe, an ACP `session/new` reply, Codex `model/list`, the
 * static flag table) is mapped into this one shape, so the composer renders
 * data and never branches on the provider.
 */
export interface EffortOption {
  id: string;
  label: string;
}

export interface CatalogModel {
  id: string;
  label: string;
  description?: string;
  isDefault: boolean;
  efforts: EffortOption[];
  /** The level the model runs at with no effort picked, when its source reports it (ACP). */
  defaultEffort?: string;
  supportsFast: boolean;
}

export interface AgentControlCatalog {
  providerId: AgentProviderId;
  source: 'probe' | 'session' | 'static';
  models: CatalogModel[];
  /** Effort levels offered when no catalogued model is selected or known to be the default. */
  providerEfforts: EffortOption[];
  /** The agent's permission modes, one of them the default; empty = it has no mode control. */
  permissionModes: PermissionModeOption[];
}

/** A selection that is valid for its catalog. `null` = the provider's default. */
export interface CatalogSelection {
  model: string | null;
  effort: string | null;
  fast: boolean;
}

/** The fields of the SDK's `ModelInfo` the catalog reads. */
export interface ClaudeProbeModel {
  value: string;
  resolvedModel?: string;
  displayName: string;
  description: string;
  supportsEffort?: boolean;
  supportedEffortLevels?: readonly string[];
  supportsFastMode?: boolean;
  supportsAutoMode?: boolean;
}

const EFFORT_LABELS: Record<string, string> = {
  xhigh: 'Extra high',
};

export function formatEffortLabel(id: string): string {
  return EFFORT_LABELS[id] ?? id.charAt(0).toUpperCase() + id.slice(1);
}

export function toEffortOptions(ids: readonly string[]): EffortOption[] {
  return ids.map((id) => ({ id, label: formatEffortLabel(id) }));
}

/**
 * Claude Code answers in two shapes. Its built-in list names each model by
 * alias ("Haiku") and leads the description with the versioned name
 * ("Haiku 4.5 · Fastest for quick answers"); once it has the server-served
 * list, `displayName` is the versioned name and the description only the
 * slogan ("Fastest for quick answers").
 */
function labelFromProbe(model: ClaudeProbeModel): string {
  const [head, slogan] = model.description.split(' · ');
  return slogan === undefined ? model.displayName : head.trim();
}

/**
 * The CLI lists a synthetic `default` row ahead of the real models; it is not
 * a model the user picks but a pointer at one, so it is dropped and the row it
 * resolves to becomes the default. The served list can leave that model out
 * (it offers `opus`, the pointer resolves to Opus with 1M context); the
 * pointer then stays, as the default — `default` is a model value the CLI
 * accepts.
 */
export function buildClaudeCatalog(probed: readonly ClaudeProbeModel[]): AgentControlCatalog {
  const pointer = probed.find((m) => m.value === 'default');
  const listed = probed.filter((m) => m.value !== 'default');
  if (listed.length === 0) {
    throw new Error('Claude Code reported no models');
  }
  const pointedAt = pointer?.resolvedModel
    ? listed.findIndex((m) => m.resolvedModel === pointer.resolvedModel)
    : 0;
  const rows = pointer && pointedAt === -1 ? [pointer, ...listed] : listed;
  const defaultIndex = Math.max(0, pointedAt);
  return {
    providerId: 'claude',
    source: 'probe',
    permissionModes: claudePermissionModes(
      rows.filter((m) => m.supportsAutoMode === true).map((m) => m.value)
    ),
    providerEfforts: [],
    models: rows.map((m, i) => ({
      id: m.value,
      label: labelFromProbe(m),
      description: m.description,
      isDefault: i === defaultIndex,
      efforts: toEffortOptions(m.supportedEffortLevels ?? []),
      supportsFast: m.supportsFastMode === true,
    })),
  };
}

/** A catalog from the static CLI-flag table in `agent-models.ts`. */
export function buildStaticCatalog(providerId: AgentProviderId): AgentControlCatalog {
  const controls = getStaticProviderControls(providerId);
  const efforts = controls?.effortArgs ? toEffortOptions(STATIC_EFFORT_LEVELS) : [];
  const models = controls?.models ?? [];
  return {
    providerId,
    source: 'static',
    permissionModes: [],
    // A flag-driven CLI's effort levels don't vary by model, so they also
    // apply when no model is picked.
    providerEfforts: efforts,
    // None is marked default: with no model picked the CLI runs its own
    // default, which this table does not know — naming one would be a guess.
    models: models.map((m) => ({
      id: m.id,
      label: m.label,
      isDefault: false,
      efforts,
      supportsFast: false,
    })),
  };
}

export function findCatalogModel(
  catalog: AgentControlCatalog,
  modelId: string | null
): CatalogModel | undefined {
  if (modelId === null) return catalog.models.find((m) => m.isDefault);
  return catalog.models.find((m) => m.id === modelId);
}

/** The effort levels on offer for `modelId` (null = the default model). */
export function effortsForModel(
  catalog: AgentControlCatalog,
  modelId: string | null
): EffortOption[] {
  const model = findCatalogModel(catalog, modelId);
  return model ? model.efforts : catalog.providerEfforts;
}

/**
 * Narrows a stored selection to what this catalog can run. Work items keep one
 * model/effort across agent switches, so a value left by another provider — or
 * a level the chosen model lacks — resolves to the provider default instead of
 * reaching a CLI that would reject it.
 */
export function resolveCatalogSelection(
  catalog: AgentControlCatalog,
  selection: { model: string | null | undefined; effort: string | null | undefined; fast: boolean }
): CatalogSelection {
  const model =
    selection.model && catalog.models.some((m) => m.id === selection.model)
      ? selection.model
      : null;
  const effort =
    selection.effort && effortsForModel(catalog, model).some((e) => e.id === selection.effort)
      ? selection.effort
      : null;
  const fast = selection.fast && findCatalogModel(catalog, model)?.supportsFast === true;
  return { model, effort, fast };
}

/** The permission modes on offer for `modelId` (null = the default model). */
export function permissionModesForModel(
  catalog: AgentControlCatalog,
  modelId: string | null
): PermissionModeOption[] {
  return modesForModel(catalog.permissionModes, findCatalogModel(catalog, modelId)?.id);
}

/**
 * The mode a session runs for a stored pick (null = none yet): the pick when
 * the model offers it, else the provider's default — a mode left by another
 * agent, or one the chosen model lacks (Claude `auto` on Haiku), must not
 * reach a CLI that would reject it. Null when the provider has no modes.
 */
export function resolvePermissionMode(
  catalog: AgentControlCatalog,
  modelId: string | null,
  stored: string | null
): PermissionModeOption | null {
  const offered = permissionModesForModel(catalog, modelId);
  if (offered.length === 0) return null;
  const mode = offered.find((m) => m.id === stored) ?? offered.find((m) => m.isDefault);
  if (!mode) throw new Error(`${catalog.providerId} offers permission modes but no default`);
  return mode;
}
