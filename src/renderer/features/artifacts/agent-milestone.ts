import type { ArtifactSource } from './artifact-surface';

export const AGENT_MILESTONE_LABEL = 'Agent update';

/** How an agent's write reached the live document. */
export type AgentContentApply = 'auto-into-empty' | 'banner';

/**
 * The cloud version to record when an agent's write lands in a document
 * (design 2026-09-24 §9 decision 4). Only the author's own editor receives
 * agent writes; a cloud tab records nothing, or a milestone would be doubled.
 */
export function agentMilestoneForApply(input: {
  source: ArtifactSource;
  apply: AgentContentApply;
}): { trigger: 'agent_milestone'; label: string } | null {
  if (input.source !== 'local') return null;
  return { trigger: 'agent_milestone', label: AGENT_MILESTONE_LABEL };
}
