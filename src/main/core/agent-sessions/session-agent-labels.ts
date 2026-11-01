import {
  findCatalogModel,
  resolvePermissionMode,
  type AgentControlCatalog,
} from '@shared/agent-control-catalog';

/** What a teammate's composer shows of the owner's chat. */
export interface SessionAgentLabels {
  /** Null for a model the catalog does not list: the owner's pill shows the agent alone. */
  modelLabel: string | null;
  /** Null for an agent with no mode control. */
  permissionModeLabel: string | null;
}

/**
 * The model and permission mode of one chat as the owner's composer names
 * them, resolved from the agent's catalog on the owner's machine (user
 * decision 2026-10-01): a teammate may not have the agent installed, so the
 * labels travel, not the ids. No pick means the agent's defaults, as the
 * session will run them. The model is found as the owner's pill finds it
 * (`findCatalogModel`, model-control.tsx), so an unlisted one goes unnamed
 * there and here alike.
 */
export function describeSessionAgentLabels(
  catalog: AgentControlCatalog,
  pick: { model: string | null; permissionMode: string | null }
): SessionAgentLabels {
  return {
    modelLabel: findCatalogModel(catalog, pick.model)?.label ?? null,
    permissionModeLabel:
      resolvePermissionMode(catalog, pick.model, pick.permissionMode)?.label ?? null,
  };
}
