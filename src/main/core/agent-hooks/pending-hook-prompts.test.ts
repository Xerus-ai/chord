import { beforeEach, describe, expect, it } from 'vitest';
import type { AgentEvent } from '@shared/events/agentEvents';
import {
  clearHookPrompt,
  listPendingHookPrompts,
  recordHookPromptEvent,
} from './pending-hook-prompts';

function hookEvent(
  sessionId: string,
  type: AgentEvent['type'],
  notificationType?: AgentEvent['payload']['notificationType']
) {
  return { type, sessionId, workItemId: 'wi-1', worktreeId: 'wt-1', payload: { notificationType } };
}

const live = (...ids: string[]) => new Set(ids);

beforeEach(() => {
  for (const prompt of listPendingHookPrompts(live())) clearHookPrompt(prompt.sessionId);
});

describe('pending-hook-prompts', () => {
  it('tracks permission and elicitation prompts', () => {
    recordHookPromptEvent(hookEvent('s-1', 'notification', 'permission_prompt'));
    recordHookPromptEvent(hookEvent('s-2', 'notification', 'elicitation_dialog'));
    expect(listPendingHookPrompts(live('s-1', 's-2'))).toEqual([
      { sessionId: 's-1', workItemId: 'wi-1', worktreeId: 'wt-1' },
      { sessionId: 's-2', workItemId: 'wi-1', worktreeId: 'wt-1' },
    ]);
  });

  it('ignores non-prompt notifications', () => {
    recordHookPromptEvent(hookEvent('s-1', 'notification', 'idle_prompt'));
    expect(listPendingHookPrompts(live('s-1'))).toEqual([]);
  });

  it('clears on a later notification, stop, or error', () => {
    recordHookPromptEvent(hookEvent('s-1', 'notification', 'permission_prompt'));
    recordHookPromptEvent(hookEvent('s-1', 'notification', 'idle_prompt'));
    recordHookPromptEvent(hookEvent('s-2', 'notification', 'permission_prompt'));
    recordHookPromptEvent(hookEvent('s-2', 'stop'));
    recordHookPromptEvent(hookEvent('s-3', 'notification', 'permission_prompt'));
    recordHookPromptEvent(hookEvent('s-3', 'error'));
    expect(listPendingHookPrompts(live('s-1', 's-2', 's-3'))).toEqual([]);
  });

  it('clears explicitly', () => {
    recordHookPromptEvent(hookEvent('s-1', 'notification', 'permission_prompt'));
    clearHookPrompt('s-1');
    expect(listPendingHookPrompts(live('s-1'))).toEqual([]);
  });

  it('drops prompts of sessions that are no longer live', () => {
    recordHookPromptEvent(hookEvent('s-1', 'notification', 'permission_prompt'));
    expect(listPendingHookPrompts(live())).toEqual([]);
    expect(listPendingHookPrompts(live('s-1'))).toEqual([]);
  });

  it('throws on a prompt with no work item', () => {
    expect(() =>
      recordHookPromptEvent({
        ...hookEvent('s-1', 'notification', 'permission_prompt'),
        workItemId: undefined,
      })
    ).toThrow('no workItemId');
  });
});
