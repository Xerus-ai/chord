import { toEffortOptions, type AgentControlCatalog } from '@shared/agent-control-catalog';
import { CODEX_PERMISSION_MODES } from '@shared/permission-modes';
import { CodexAppServerClient } from './app-server-client';
import type { Model } from './protocol/v2/Model';
import type { ModelListParams } from './protocol/v2/ModelListParams';
import type { ModelListResponse } from './protocol/v2/ModelListResponse';

/**
 * The service tier a model offers as its Fast speed. Codex lists tiers by an
 * opaque id (`priority`) with a display name; the name is what marks the
 * speed-up, matching the Codex app's own Fast toggle.
 */
export function findFastTier(model: Model): string | null {
  return model.serviceTiers.find((t) => t.name.toLowerCase() === 'fast')?.id ?? null;
}

/** The composer catalog for Codex, from app-server `model/list`. */
export function buildCodexCatalog(models: readonly Model[]): AgentControlCatalog {
  const listed = models.filter((m) => !m.hidden);
  if (listed.length === 0) throw new Error('Codex reported no models');
  return {
    providerId: 'codex',
    source: 'probe',
    permissionModes: [...CODEX_PERMISSION_MODES],
    providerEfforts: [],
    models: listed.map((m) => ({
      id: m.id,
      label: m.displayName,
      description: m.description,
      isDefault: m.isDefault,
      efforts: toEffortOptions(m.supportedReasoningEfforts.map((e) => e.reasoningEffort)),
      defaultEffort: m.defaultReasoningEffort,
      supportsFast: findFastTier(m) !== null,
    })),
  };
}

/** Every page of `model/list`. */
export async function listCodexModels(client: CodexAppServerClient): Promise<Model[]> {
  const models: Model[] = [];
  let cursor: string | null = null;
  do {
    const params: ModelListParams = { cursor };
    const page: ModelListResponse = await client.request('model/list', params);
    models.push(...page.data);
    cursor = page.nextCursor;
  } while (cursor !== null);
  return models;
}

/**
 * Asks the installed Codex for its models over a short-lived app-server — the
 * same list the Codex app's picker shows, with each model's effort levels and
 * speed tiers. No thread is started, so nothing is billed.
 */
export function probeCodexCatalog(command: string, cwd: string): Promise<AgentControlCatalog> {
  return CodexAppServerClient.runOnce(command, cwd, async (client) =>
    buildCodexCatalog(await listCodexModels(client))
  );
}
