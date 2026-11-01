import type { CatalogSelection } from '@shared/agent-control-catalog';
import { CODEX_PERMISSION_MODES } from '@shared/permission-modes';
import { findFastTier } from './codex-catalog';
import type { CollaborationMode } from './protocol/CollaborationMode';
import type { ReasoningEffort } from './protocol/ReasoningEffort';
import type { AskForApproval } from './protocol/v2/AskForApproval';
import type { Model } from './protocol/v2/Model';
import type { SandboxPolicy } from './protocol/v2/SandboxPolicy';

/** The policy a thread was opened with, as its `thread/start` / `thread/resume` reply states it. */
export interface CodexThreadPolicy {
  approvalPolicy: AskForApproval;
  sandbox: SandboxPolicy;
}

export interface CodexTurnOverrides {
  model: string;
  effort: ReasoningEffort;
  /** The Fast tier's id, or null for standard speed (clears a tier set earlier). */
  serviceTier: string | null;
  approvalPolicy: AskForApproval;
  sandboxPolicy: SandboxPolicy;
  collaborationMode: CollaborationMode;
}

/**
 * Each Codex mode as an approval policy and sandbox. Agent and plan run on
 * the thread's own policy — the sandbox the user's config materialised at
 * `thread/start` — so picking them back restores it exactly.
 */
function modePolicy(modeId: string, thread: CodexThreadPolicy): CodexThreadPolicy {
  switch (modeId) {
    case 'read-only':
      return { approvalPolicy: 'on-request', sandbox: { type: 'readOnly', networkAccess: false } };
    case 'agent':
    case 'plan':
      return thread;
    case 'full-access':
      return { approvalPolicy: 'never', sandbox: { type: 'dangerFullAccess' } };
    default:
      throw new Error(`Codex has no permission mode ${modeId}`);
  }
}

/**
 * The settings every `turn/start` carries. Codex keeps turn overrides for the
 * rest of the thread, so each turn states all of them: a default pick is sent
 * as the default model and its default effort, and each mode restates its
 * policy and collaboration mode — otherwise the thread would stay on whatever
 * an earlier turn chose. `selection` and `modeId` must already be resolved
 * against the Codex catalog.
 */
export function buildCodexTurnOverrides(
  models: readonly Model[],
  selection: CatalogSelection,
  modeId: string,
  thread: CodexThreadPolicy
): CodexTurnOverrides {
  const model =
    selection.model === null
      ? models.find((m) => m.isDefault && !m.hidden)
      : models.find((m) => m.id === selection.model);
  if (!model) {
    throw new Error(`Codex does not offer model ${selection.model ?? '(default)'}`);
  }
  const mode = CODEX_PERMISSION_MODES.find((m) => m.id === modeId);
  if (!mode) throw new Error(`Codex has no permission mode ${modeId}`);
  const policy = modePolicy(mode.id, thread);
  const effort = (selection.effort as ReasoningEffort | null) ?? model.defaultReasoningEffort;
  return {
    model: model.id,
    effort,
    serviceTier: selection.fast ? findFastTier(model) : null,
    approvalPolicy: policy.approvalPolicy,
    sandboxPolicy: policy.sandbox,
    collaborationMode: {
      mode: mode.isPlan ? 'plan' : 'default',
      settings: { model: model.id, reasoning_effort: effort, developer_instructions: null },
    },
  };
}
