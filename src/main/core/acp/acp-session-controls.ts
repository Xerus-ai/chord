import {
  findCatalogModel,
  toEffortOptions,
  type AgentControlCatalog,
  type CatalogModel,
  type CatalogSelection,
} from '@shared/agent-control-catalog';
import type { AgentProviderId } from '@shared/agent-provider-registry';
import type { PermissionModeOption } from '@shared/permission-modes';

/**
 * What an ACP session can be switched to — its model, effort and mode — read
 * from the agent's own replies. Agents describe these as `configOptions`
 * (categories `model`, `thought_level`, `mode`), set with
 * `session/set_config_option`; some also still send the older `models` /
 * `modes` fields, set with `session/set_model` / `session/set_mode`, which
 * are read only when no config option covers them.
 */
export interface AcpChoice {
  value: string;
  name: string;
  description?: string;
}

export type AcpControlSetter =
  | { kind: 'config'; configId: string }
  | { kind: 'legacy-model' }
  | { kind: 'legacy-mode' };

export interface AcpSelectControl {
  setter: AcpControlSetter;
  currentValue: string;
  options: AcpChoice[];
}

export interface AcpSessionControls {
  model: AcpSelectControl | null;
  effort: AcpSelectControl | null;
  mode: AcpSelectControl | null;
}

/** A `session/new` or `session/set_config_option` reply, or a `config_option_update`: wire data. */
export interface AcpControlsReply {
  configOptions?: readonly unknown[] | null;
  models?: unknown;
  modes?: unknown;
}

const CATEGORY_SLOTS: Record<string, keyof AcpSessionControls> = {
  model: 'model',
  thought_level: 'effort',
  mode: 'mode',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function malformed(what: string, raw: unknown): Error {
  return new Error(`Malformed ACP ${what}: ${JSON.stringify(raw)}`);
}

function toChoice(value: unknown, name: unknown, description: unknown, raw: unknown): AcpChoice {
  if (typeof value !== 'string' || typeof name !== 'string') throw malformed('choice', raw);
  return typeof description === 'string' ? { value, name, description } : { value, name };
}

function readSelectOptions(raw: unknown): AcpChoice[] {
  if (!Array.isArray(raw)) throw malformed('select options', raw);
  return raw.flatMap((item: unknown) => {
    if (isRecord(item) && 'group' in item) return readSelectOptions(item.options);
    if (!isRecord(item)) throw malformed('select option', item);
    return [toChoice(item.value, item.name, item.description, item)];
  });
}

function readConfigControls(configOptions: readonly unknown[]): Partial<AcpSessionControls> {
  const found: Partial<AcpSessionControls> = {};
  for (const raw of configOptions) {
    if (!isRecord(raw)) throw malformed('config option', raw);
    // Boolean options and categories the composer does not drive are not controls here.
    if (raw.type !== 'select' || typeof raw.category !== 'string') continue;
    const slot = CATEGORY_SLOTS[raw.category];
    if (!slot || found[slot]) continue;
    if (typeof raw.id !== 'string' || typeof raw.currentValue !== 'string') {
      throw malformed('config option', raw);
    }
    found[slot] = {
      setter: { kind: 'config', configId: raw.id },
      currentValue: raw.currentValue,
      options: readSelectOptions(raw.options),
    };
  }
  return found;
}

function readLegacyModels(raw: unknown): AcpSelectControl | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw) || !Array.isArray(raw.availableModels)) throw malformed('models', raw);
  if (typeof raw.currentModelId !== 'string') throw malformed('models', raw);
  return {
    setter: { kind: 'legacy-model' },
    currentValue: raw.currentModelId,
    options: raw.availableModels.map((m: unknown) => {
      if (!isRecord(m)) throw malformed('model', m);
      return toChoice(m.modelId, m.name, m.description, m);
    }),
  };
}

function readLegacyModes(raw: unknown): AcpSelectControl | null {
  if (raw === undefined || raw === null) return null;
  if (!isRecord(raw) || !Array.isArray(raw.availableModes)) throw malformed('modes', raw);
  if (typeof raw.currentModeId !== 'string') throw malformed('modes', raw);
  return {
    setter: { kind: 'legacy-mode' },
    currentValue: raw.currentModeId,
    options: raw.availableModes.map((m: unknown) => {
      if (!isRecord(m)) throw malformed('mode', m);
      return toChoice(m.id, m.name, m.description, m);
    }),
  };
}

/**
 * The session's controls after `reply`. A control the reply does not mention
 * keeps its `previous` state — a legacy `set_model` reply is empty, and the
 * agent's config options only describe what it exposes that way.
 */
export function readAcpControls(
  reply: AcpControlsReply,
  previous?: AcpSessionControls
): AcpSessionControls {
  const config = readConfigControls(reply.configOptions ?? []);
  return {
    model: config.model ?? readLegacyModels(reply.models) ?? previous?.model ?? null,
    effort: config.effort ?? previous?.effort ?? null,
    mode: config.mode ?? readLegacyModes(reply.modes) ?? previous?.mode ?? null,
  };
}

/** `current_mode_update`: the agent switched mode (itself, or after a legacy `set_mode`). */
export function applyCurrentModeUpdate(
  controls: AcpSessionControls,
  currentModeId: string
): AcpSessionControls {
  if (!controls.mode) return controls;
  return { ...controls, mode: { ...controls.mode, currentValue: currentModeId } };
}

/** The mode that is the agent's plan mode: id `plan`, or a namespaced id ending in `#plan`. */
export function findPlanModeValue(controls: AcpSessionControls): string | null {
  const plan = controls.mode?.options.find((o) => o.value === 'plan' || o.value.endsWith('#plan'));
  return plan?.value ?? null;
}

/**
 * A mode that runs with every check off. ACP carries no such flag, so it is
 * known by id: claude-agent-acp's `bypassPermissions`, Claude Code's own name.
 */
const DANGER_MODE_IDS = new Set(['bypassPermissions']);

/**
 * Every mode the agent reports, labelled as it labels them. The mode the
 * session started in (kept from `previous`, like the default model) is the
 * default — where leaving plan mode returns to when nothing else was picked.
 */
function buildAcpPermissionModes(
  controls: AcpSessionControls,
  previous: AgentControlCatalog | null
): PermissionModeOption[] {
  if (!controls.mode) return [];
  const options = controls.mode.options;
  const plan = findPlanModeValue(controls);
  const previousDefault = previous?.permissionModes.find((m) => m.isDefault)?.id;
  const defaultId =
    previousDefault && options.some((o) => o.value === previousDefault)
      ? previousDefault
      : controls.mode.currentValue;
  return options.map((o) => ({
    id: o.value,
    label: o.name,
    ...(o.description ? { description: o.description } : {}),
    isDefault: o.value === defaultId,
    isPlan: o.value === plan,
    danger: DANGER_MODE_IDS.has(o.value),
  }));
}

/**
 * The session's catalog. Agents report effort levels only for the current
 * model, so other models carry what this session already learned about them
 * (`previous`) or none — never a guess. The model the session started on is
 * the default for its life, and the level a model was at when it became
 * current is that model's default effort.
 */
export function buildAcpCatalog(
  providerId: AgentProviderId,
  controls: AcpSessionControls,
  previous: AgentControlCatalog | null
): AgentControlCatalog {
  const efforts = toEffortOptions(controls.effort?.options.map((o) => o.value) ?? []);
  const permissionModes = buildAcpPermissionModes(controls, previous);
  if (!controls.model) {
    return { providerId, source: 'session', models: [], providerEfforts: efforts, permissionModes };
  }
  const current = controls.model.currentValue;
  const options = controls.model.options;
  const previousDefault = previous?.models.find((m) => m.isDefault)?.id;
  const defaultId =
    previousDefault && options.some((o) => o.value === previousDefault) ? previousDefault : current;
  const models = options.map((o): CatalogModel => {
    const learned = previous?.models.find((m) => m.id === o.value);
    const isCurrent = o.value === current && controls.effort !== null;
    const defaultEffort =
      learned?.defaultEffort ?? (isCurrent ? controls.effort?.currentValue : undefined);
    return {
      id: o.value,
      label: o.name,
      ...(o.description ? { description: o.description } : {}),
      isDefault: o.value === defaultId,
      efforts: isCurrent ? efforts : (learned?.efforts ?? []),
      ...(defaultEffort !== undefined ? { defaultEffort } : {}),
      supportsFast: false,
    };
  });
  return { providerId, source: 'session', models, providerEfforts: [], permissionModes };
}

/** The JSON-RPC call that sets `control` to `value` (the session id is added by the client). */
export function acpSetRequest(
  control: AcpSelectControl,
  value: string
): { method: string; params: Record<string, string> } {
  switch (control.setter.kind) {
    case 'config':
      return {
        method: 'session/set_config_option',
        params: { configId: control.setter.configId, value },
      };
    case 'legacy-model':
      return { method: 'session/set_model', params: { modelId: value } };
    case 'legacy-mode':
      return { method: 'session/set_mode', params: { modeId: value } };
  }
}

/** The model to switch the session to for `selection`, or null when it already runs it. */
export function acpModelTarget(
  controls: AcpSessionControls,
  catalog: AgentControlCatalog,
  selection: CatalogSelection
): string | null {
  if (!controls.model) return null;
  const target = selection.model ?? catalog.models.find((m) => m.isDefault)?.id;
  return target === undefined || target === controls.model.currentValue ? null : target;
}

/**
 * The effort to switch to for `selection` once its model is current, or null
 * when it is already set. A default pick means the model's default level.
 */
export function acpEffortTarget(
  controls: AcpSessionControls,
  catalog: AgentControlCatalog,
  selection: CatalogSelection
): string | null {
  if (!controls.effort) return null;
  const target = selection.effort ?? findCatalogModel(catalog, selection.model)?.defaultEffort;
  return target === undefined || target === controls.effort.currentValue ? null : target;
}

/**
 * The mode to switch the session to, or null when it is already in it.
 * `modeId` must be one the agent offers — resolved against its catalog.
 */
export function acpModeTarget(controls: AcpSessionControls, modeId: string): string | null {
  if (!controls.mode) throw new Error(`The agent has no mode control to switch to ${modeId}`);
  if (!controls.mode.options.some((o) => o.value === modeId)) {
    throw new Error(`The agent does not offer mode ${modeId}`);
  }
  return modeId === controls.mode.currentValue ? null : modeId;
}
