import { describe, expect, it } from 'vitest';
import type { AgentSessionRow } from '@main/db/schema-work-items';
import { validateTargetSession } from './validate-target-session';

function makeRow(overrides: Partial<AgentSessionRow> = {}): AgentSessionRow {
  return {
    id: 'session-1',
    workItemId: 'item-1',
    kind: 'chat',
    agentProviderId: 'claude',
    shell: null,
    communication: 'pty',
    externalSessionId: null,
    title: null,
    cwd: null,
    status: 'suspended',
    respawnCount: 0,
    provisionStatus: 'pending',
    worktreeId: 'wt-1',
    createdAt: 0,
    lastActiveAt: 0,
    lastTurnStatus: null,
    lastTurnStatusAt: null,
    model: null,
    ...overrides,
  };
}

describe('validateTargetSession', () => {
  it('accepts a chat session belonging to the work item that is not done', () => {
    const row = makeRow();
    const result = validateTargetSession(row, 'item-1');
    expect(result).toEqual({ success: true, data: row });
  });

  it('accepts an active chat session, not just suspended', () => {
    const row = makeRow({ status: 'active' });
    expect(validateTargetSession(row, 'item-1')).toEqual({ success: true, data: row });
  });

  it('rejects a missing session row', () => {
    const result = validateTargetSession(undefined, 'item-1');
    expect(result.success).toBe(false);
    expect(!result.success && result.error.type).toBe('session_not_found');
  });

  it('rejects a session that belongs to a different work item', () => {
    const row = makeRow({ workItemId: 'item-2' });
    const result = validateTargetSession(row, 'item-1');
    expect(result.success).toBe(false);
    expect(!result.success && result.error.type).toBe('session_not_found');
  });

  it('rejects a terminal session', () => {
    const row = makeRow({ kind: 'terminal' });
    const result = validateTargetSession(row, 'item-1');
    expect(result.success).toBe(false);
    expect(!result.success && result.error.type).toBe('session_not_chat');
  });

  it('rejects a session that has ended', () => {
    const row = makeRow({ status: 'done' });
    const result = validateTargetSession(row, 'item-1');
    expect(result.success).toBe(false);
    expect(!result.success && result.error.type).toBe('session_done');
  });
});
