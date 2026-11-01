import { describe, expect, it } from 'vitest';
import { AGENT_MILESTONE_LABEL, agentMilestoneForApply } from './agent-milestone';

/**
 * When an agent's write lands in a document's live state, the author's editor
 * records a cloud `agent_milestone` version (design 2026-09-24 §9 decision 4,
 * revised 2026-09-26). Only the author's own editor does: a teammate's cloud
 * tab never receives agent writes, and recording one there would double it.
 */
describe('agentMilestoneForApply', () => {
  it('the author’s editor auto-applying into an empty document records a milestone', () => {
    expect(agentMilestoneForApply({ source: 'local', apply: 'auto-into-empty' })).toEqual({
      trigger: 'agent_milestone',
      label: 'Agent update',
    });
  });

  it('the author applying a held update from the banner records a milestone', () => {
    expect(agentMilestoneForApply({ source: 'local', apply: 'banner' })).toEqual({
      trigger: 'agent_milestone',
      label: AGENT_MILESTONE_LABEL,
    });
  });

  it('a cloud tab records nothing, however the content arrived', () => {
    expect(agentMilestoneForApply({ source: 'cloud', apply: 'auto-into-empty' })).toBeNull();
    expect(agentMilestoneForApply({ source: 'cloud', apply: 'banner' })).toBeNull();
  });

  it('the label is the one the history panel shows', () => {
    expect(AGENT_MILESTONE_LABEL).toBe('Agent update');
  });
});
