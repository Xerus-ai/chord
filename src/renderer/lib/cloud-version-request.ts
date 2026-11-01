export type CloudVersionTrigger = 'manual' | 'agent_milestone';

export type SaveVersionRequest =
  | { trigger: 'manual'; baseVersion: number; label?: string }
  | { trigger: 'agent_milestone'; label: string };

export type SaveVersionBody =
  | { trigger: 'manual'; base_version: number; label?: string }
  | { trigger: 'agent_milestone'; label: string };

/**
 * The body of `POST /work-items/:wid/artifacts/:aid/versions` for a document;
 * the server snapshots the live Yjs state. A manual save names the version it
 * was made on (a stale base is a 409). An agent milestone records what the
 * agent wrote, not an edit on a seen version, so it carries no base.
 */
export function buildSaveVersionBody(request: SaveVersionRequest): SaveVersionBody {
  if (request.trigger === 'agent_milestone') {
    return { trigger: 'agent_milestone', label: request.label };
  }
  return request.label === undefined
    ? { trigger: 'manual', base_version: request.baseVersion }
    : { trigger: 'manual', base_version: request.baseVersion, label: request.label };
}
