import { describe, expect, it } from 'vitest';
import type { ChatSessionHandle } from '@main/core/agent-sessions/chat-handle';
import type { ActiveSession } from '@main/core/work-items/active-sessions';
import { findPlanOwner, planFollowUpPrompt } from './plan-follow-up';

function session(overrides: Partial<ActiveSession> & Pick<ActiveSession, 'sessionId'>) {
  return {
    workItemId: 'wi-1',
    providerId: 'codex',
    mode: 'codex-app-server',
    kind: 'chat',
    chatHandle: {} as ChatSessionHandle,
    ...overrides,
  } as ActiveSession;
}

describe('findPlanOwner', () => {
  it('picks the session that published the plan, not the first sibling', () => {
    const sessions = [session({ sessionId: 's1' }), session({ sessionId: 's2' })];
    expect(findPlanOwner(sessions, 's2')?.sessionId).toBe('s2');
  });

  it('finds an ACP owner, which has no structured handle', () => {
    const sessions = [
      session({ sessionId: 's1' }),
      session({ sessionId: 's2', providerId: 'opencode', mode: 'acp', chatHandle: undefined }),
    ];
    expect(findPlanOwner(sessions, 's2')?.sessionId).toBe('s2');
  });

  it('finds no owner when the publishing session is no longer live', () => {
    expect(findPlanOwner([session({ sessionId: 's1' })], 's9')).toBeUndefined();
  });

  it('finds no owner for a plan published without a session', () => {
    expect(findPlanOwner([session({ sessionId: 's1' })], null)).toBeUndefined();
  });

  it('does not treat a PTY session as able to answer a plan', () => {
    const pty = session({ sessionId: 's1', mode: 'pty', chatHandle: undefined });
    expect(findPlanOwner([pty], 's1')).toBeUndefined();
  });
});

describe('planFollowUpPrompt', () => {
  it('tells the agent to implement an approved plan', () => {
    expect(planFollowUpPrompt('approve')).toBe('Plan approved. Proceed with implementation.');
  });

  it('carries approval feedback', () => {
    expect(planFollowUpPrompt('approve', 'skip the migration')).toBe(
      'Plan approved with feedback: skip the migration. Proceed with implementation.'
    );
  });

  it('asks for a revision when the plan needs adjusting', () => {
    expect(planFollowUpPrompt('adjust', 'split step 2')).toBe(
      'The plan needs adjustments before approval: split step 2. Revise the plan and present it again.'
    );
  });

  it('asks for an alternative when the plan is rejected, or adjusted without feedback', () => {
    const rejected = 'Plan rejected. Please propose an alternative approach.';
    expect(planFollowUpPrompt('reject')).toBe(rejected);
    expect(planFollowUpPrompt('adjust')).toBe(rejected);
  });
});
