import { describe, expect, it } from 'vitest';
import type { NotificationType } from '@shared/events/agentEvents';
import type { StreamItem, TurnStreamAction } from '@shared/stream-items';
import {
  applyAgentEvent,
  applyPendingInputSeed,
  applySeed,
  applyTurnStreamEvent,
  createInitialLiveWorktreeStatusState,
  type LiveWorktreeStatusState,
} from './live-worktree-status-reducer';

function notification(ref: { sessionId: string; workItemId: string; worktreeId: string }) {
  return { type: 'notification' as const, payload: {}, ...ref };
}

function stop(ref: { sessionId: string; workItemId: string; worktreeId: string }) {
  return { type: 'stop' as const, payload: {}, ...ref };
}

const S1 = { sessionId: 's1', workItemId: 'wi-a', worktreeId: 'wt-1' };
const S2 = { sessionId: 's2', workItemId: 'wi-a', worktreeId: 'wt-2' };

describe('applyAgentEvent', () => {
  it('notification marks the session, worktree, and work item as live', () => {
    const state = applyAgentEvent(createInitialLiveWorktreeStatusState(), notification(S1));
    expect(state.streamingSessionIds).toEqual(new Set(['s1']));
    expect(state.streamingWorktreeIds).toEqual(new Set(['wt-1']));
    expect(state.runningWorkItemIds).toEqual(new Set(['wi-a']));
  });

  it('notification then stop clears the session, its worktree, and its work item', () => {
    let state = createInitialLiveWorktreeStatusState();
    state = applyAgentEvent(state, notification(S1));
    state = applyAgentEvent(state, stop(S1));
    expect(state.streamingSessionIds.size).toBe(0);
    expect(state.streamingWorktreeIds.size).toBe(0);
    expect(state.runningWorkItemIds.size).toBe(0);
    expect(state.stoppedSessionIds).toEqual(new Set(['s1']));
  });

  it('events with no workItemId (classifier path) are ignored', () => {
    const initial = createInitialLiveWorktreeStatusState();
    const state = applyAgentEvent(initial, {
      type: 'notification',
      sessionId: 's1',
      worktreeId: 'wt-1',
      workItemId: undefined,
      payload: {},
    });
    expect(state).toBe(initial);
  });

  it('a late seed after a stop does not resurrect the session', () => {
    let state = createInitialLiveWorktreeStatusState();
    state = applyAgentEvent(state, notification(S1));
    state = applyAgentEvent(state, stop(S1));

    const seeded = applySeed(state, [S1]);

    expect(seeded.streamingSessionIds.size).toBe(0);
    expect(seeded.runningWorkItemIds.size).toBe(0);
  });

  it('a seed with no prior events plainly seeds running state', () => {
    const seeded = applySeed(createInitialLiveWorktreeStatusState(), [S1, S2]);

    expect(seeded.streamingSessionIds).toEqual(new Set(['s1', 's2']));
    expect(seeded.streamingWorktreeIds).toEqual(new Set(['wt-1', 'wt-2']));
    expect(seeded.runningWorkItemIds).toEqual(new Set(['wi-a']));
  });

  it('stopping one of two worktrees on a work item leaves the other streaming and the item running', () => {
    let state = createInitialLiveWorktreeStatusState();
    state = applyAgentEvent(state, notification(S1));
    state = applyAgentEvent(state, notification(S2));

    state = applyAgentEvent(state, stop(S1));

    expect(state.streamingSessionIds).toEqual(new Set(['s2']));
    expect(state.streamingWorktreeIds).toEqual(new Set(['wt-2']));
    expect(state.streamingWorktreeIds.has('wt-1')).toBe(false);
    // The work item still has a live session (s2), so it's still running.
    expect(state.runningWorkItemIds).toEqual(new Set(['wi-a']));
  });

  it('notification after a stop on the same session revives it', () => {
    let state = createInitialLiveWorktreeStatusState();
    state = applyAgentEvent(state, notification(S1));
    state = applyAgentEvent(state, stop(S1));
    state = applyAgentEvent(state, notification(S1));

    expect(state.streamingSessionIds).toEqual(new Set(['s1']));
    expect(state.stoppedSessionIds.has('s1')).toBe(false);
  });

  it('returns the same reference when an event is a no-op', () => {
    const state: LiveWorktreeStatusState = applyAgentEvent(
      createInitialLiveWorktreeStatusState(),
      notification(S1)
    );
    const next = applyAgentEvent(state, notification(S1));
    expect(next).toBe(state);
  });
});

function prompt(
  ref: { sessionId: string; workItemId: string; worktreeId: string },
  notificationType: NotificationType
) {
  return { type: 'notification' as const, payload: { notificationType }, ...ref };
}

function permission(id: string, resolved?: boolean): StreamItem {
  return {
    kind: 'permission',
    id,
    requestId: `req-${id}`,
    name: 'Bash',
    title: 'Bash',
    options: [],
    resolved,
  };
}

function plan(id: string, status: 'pending' | 'approved' | 'expired'): StreamItem {
  return {
    kind: 'plan_approval',
    id,
    artifactId: 'a',
    title: 'Plan',
    overview: '',
    steps: [],
    status,
  };
}

function turn(sessionId: string | undefined, action: TurnStreamAction) {
  return { sessionId, action };
}

describe('pending input', () => {
  it('a hook permission prompt marks the session pending until a later notification', () => {
    let state = applyAgentEvent(
      createInitialLiveWorktreeStatusState(),
      prompt(S1, 'permission_prompt')
    );
    expect(state.pendingInputSessionIds).toEqual(new Set(['s1']));
    expect(state.streamingSessionIds).toEqual(new Set(['s1']));

    state = applyAgentEvent(state, notification(S1));
    expect(state.pendingInputSessionIds.size).toBe(0);
  });

  it('stop clears a pending hook prompt', () => {
    let state = applyAgentEvent(
      createInitialLiveWorktreeStatusState(),
      prompt(S1, 'elicitation_dialog')
    );
    state = applyAgentEvent(state, stop(S1));
    expect(state.pendingInputSessionIds.size).toBe(0);
  });

  it('a permission item sets pending and resolving it clears', () => {
    let state = applyTurnStreamEvent(
      createInitialLiveWorktreeStatusState(),
      turn('s1', { type: 'item_added', item: permission('p1') })
    );
    expect(state.pendingInputSessionIds).toEqual(new Set(['s1']));

    state = applyTurnStreamEvent(
      state,
      turn('s1', { type: 'item_updated', itemId: 'p1', item: permission('p1', true) })
    );
    expect(state.pendingInputSessionIds.size).toBe(0);
  });

  it('stays pending while any of several requests is unresolved', () => {
    let state = applyTurnStreamEvent(
      createInitialLiveWorktreeStatusState(),
      turn('s1', {
        type: 'items_batch',
        actions: [
          { type: 'item_added', item: permission('p1') },
          { type: 'item_added', item: plan('plan1', 'pending') },
        ],
      })
    );
    state = applyTurnStreamEvent(
      state,
      turn('s1', { type: 'item_updated', itemId: 'p1', item: permission('p1', true) })
    );
    expect(state.pendingInputSessionIds).toEqual(new Set(['s1']));

    state = applyTurnStreamEvent(
      state,
      turn('s1', { type: 'item_updated', itemId: 'plan1', item: plan('plan1', 'expired') })
    );
    expect(state.pendingInputSessionIds.size).toBe(0);
  });

  it('turn completion clears only that session', () => {
    let state = createInitialLiveWorktreeStatusState();
    state = applyTurnStreamEvent(state, turn('s1', { type: 'item_added', item: permission('p1') }));
    state = applyTurnStreamEvent(state, turn('s2', { type: 'item_added', item: permission('p2') }));
    state = applyTurnStreamEvent(state, turn('s1', { type: 'turn_completed' }));
    expect(state.pendingInputSessionIds).toEqual(new Set(['s2']));
  });

  it('applyPendingInputSeed marks a session pending at mount', () => {
    const seeded = applyPendingInputSeed(createInitialLiveWorktreeStatusState(), [S1]);
    expect(seeded.pendingInputSessionIds).toEqual(new Set(['s1']));
  });

  it('applyPendingInputSeed does not resurrect a session the stream already stopped', () => {
    let state = applyAgentEvent(createInitialLiveWorktreeStatusState(), notification(S1));
    state = applyAgentEvent(state, stop(S1));

    const seeded = applyPendingInputSeed(state, [S1]);
    expect(seeded.pendingInputSessionIds.size).toBe(0);
  });

  it('applyPendingInputSeed does not override a session the live stream already resolved', () => {
    let state = applyTurnStreamEvent(
      createInitialLiveWorktreeStatusState(),
      turn('s1', { type: 'item_added', item: permission('p1') })
    );
    state = applyTurnStreamEvent(
      state,
      turn('s1', { type: 'item_updated', itemId: 'p1', item: permission('p1', true) })
    );
    expect(state.pendingInputSessionIds.size).toBe(0);

    const seeded = applyPendingInputSeed(state, [S1]);
    expect(seeded.pendingInputSessionIds.size).toBe(0);
  });

  it('a real turn-stream event clears the seed placeholder once it arrives', () => {
    const seeded = applyPendingInputSeed(createInitialLiveWorktreeStatusState(), [S1]);
    expect(seeded.pendingInputSessionIds).toEqual(new Set(['s1']));

    const resolved = applyTurnStreamEvent(seeded, turn('s1', { type: 'turn_completed' }));
    expect(resolved.pendingInputSessionIds.size).toBe(0);
  });

  it('a hook notification clears the seed placeholder of a PTY session', () => {
    const seeded = applyPendingInputSeed(createInitialLiveWorktreeStatusState(), [S1]);
    expect(seeded.pendingInputSessionIds).toEqual(new Set(['s1']));

    const answered = applyAgentEvent(seeded, prompt(S1, 'idle_prompt'));
    expect(answered.pendingInputSessionIds.size).toBe(0);
  });

  it('a hook prompt after the seed keeps the session pending', () => {
    const seeded = applyPendingInputSeed(createInitialLiveWorktreeStatusState(), [S1]);
    const prompted = applyAgentEvent(seeded, prompt(S1, 'permission_prompt'));
    expect(prompted.pendingInputSessionIds).toEqual(new Set(['s1']));
  });

  it('ignores events without a session', () => {
    const initial = createInitialLiveWorktreeStatusState();
    expect(
      applyTurnStreamEvent(initial, turn(undefined, { type: 'item_added', item: permission('p1') }))
    ).toBe(initial);
  });

  it('a non-request item leaves pendingInputSessionIds empty but still marks the session touched', () => {
    const initial = createInitialLiveWorktreeStatusState();
    const state = applyTurnStreamEvent(
      initial,
      turn('s1', { type: 'item_added', item: { kind: 'text', id: 't', text: 'hi' } })
    );
    expect(state.pendingInputSessionIds.size).toBe(0);

    // Proven by a seed no longer being able to mark it pending afterwards.
    const seeded = applyPendingInputSeed(state, [S1]);
    expect(seeded.pendingInputSessionIds.size).toBe(0);
  });
});
