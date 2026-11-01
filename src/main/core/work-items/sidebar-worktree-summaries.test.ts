import { describe, expect, it } from 'vitest';
import { labelAgentSession } from '@shared/agent-session-label';
import { deriveWorkItemStatus } from '@shared/work-item-status';
import {
  attributePendingRequests,
  buildWorktreeSummary,
  computeUnread,
  type BuildWorktreeSummaryInput,
} from './sidebar-worktree-summaries';

function baseInput(overrides: Partial<BuildWorktreeSummaryInput> = {}): BuildWorktreeSummaryInput {
  return {
    id: 'wt-1',
    branch: 'feat/x',
    targetRef: 'origin/main',
    title: null,
    isPrimary: true,
    diffStats: null,
    sessions: [],
    liveSessions: [],
    pendingPermissionRequests: 0,
    pendingPlanRequests: 0,
    gitOperationFailed: false,
    hasUnreadFinishedTurn: false,
    ...overrides,
  };
}

describe('buildWorktreeSummary', () => {
  it('idles a primary worktree with no sessions and diff stats intact', () => {
    const summary = buildWorktreeSummary(baseInput({ diffStats: { added: 5, removed: 1 } }));
    expect(summary).toEqual({
      id: 'wt-1',
      branch: 'feat/x',
      // Where the lane's PR merges: the sidebar's "branch → target" label.
      targetRef: 'origin/main',
      title: null,
      isPrimary: true,
      diffStats: { added: 5, removed: 1 },
      providerId: null,
      bucket: 'idle',
      liveSessions: [],
    });
  });

  it('reports the newest session provider and marks the worktree working while a turn streams', () => {
    const summary = buildWorktreeSummary(
      baseInput({
        isPrimary: false,
        sessions: [
          {
            id: 's-old',
            status: 'active',
            kind: 'chat',
            agentProviderId: 'codex',
            title: 'old',
            createdAt: 1,
            lastActiveAt: 1,
            lastTurnStatus: null,
          },
          {
            id: 's-new',
            status: 'active',
            kind: 'chat',
            agentProviderId: 'claude',
            title: 'new',
            createdAt: 5,
            lastActiveAt: 9,
            lastTurnStatus: null,
          },
        ],
        liveSessions: [
          { sessionId: 's-new', isTurnStreaming: true, subagents: [{ name: 'planner' }] },
        ],
      })
    );
    expect(summary.providerId).toBe('claude');
    expect(summary.bucket).toBe('working');
    expect(summary.liveSessions).toEqual([
      {
        sessionId: 's-new',
        kind: 'chat',
        title: 'new',
        lastActiveAt: 9,
        providerId: 'claude',
        subagents: [{ name: 'planner' }],
      },
    ]);
  });

  // devstation-jop: the sidebar row names an agent terminal with the same
  // function as the centre tab and the rail, so it needs the session's kind.
  it('carries an agent terminal’s kind, so its sidebar row is named after the agent', () => {
    const summary = buildWorktreeSummary(
      baseInput({
        sessions: [
          {
            id: 's-claude-terminal',
            status: 'active',
            kind: 'terminal',
            agentProviderId: 'claude',
            title: null,
            createdAt: 1,
            lastActiveAt: 1,
            lastTurnStatus: null,
          },
        ],
        liveSessions: [{ sessionId: 's-claude-terminal', isTurnStreaming: false, subagents: [] }],
      })
    );
    const [row] = summary.liveSessions;
    expect(row).toMatchObject({ kind: 'terminal', providerId: 'claude', title: null });
    expect(
      labelAgentSession({ kind: row!.kind, title: row!.title, agentProviderId: row!.providerId })
    ).toBe('Claude Code');
  });

  it("carries each live session's own provider, not the worktree's newest", () => {
    const summary = buildWorktreeSummary(
      baseInput({
        sessions: [
          {
            id: 's-codex',
            status: 'active',
            kind: 'chat',
            agentProviderId: 'codex',
            title: 'codex run',
            createdAt: 1,
            lastActiveAt: 2,
            lastTurnStatus: null,
          },
          {
            id: 's-claude',
            status: 'active',
            kind: 'chat',
            agentProviderId: 'claude',
            title: 'claude run',
            createdAt: 9,
            lastActiveAt: 9,
            lastTurnStatus: null,
          },
          {
            id: 's-unknown',
            status: 'active',
            kind: 'terminal',
            agentProviderId: null,
            title: 'terminal',
            createdAt: 3,
            lastActiveAt: 3,
            lastTurnStatus: null,
          },
        ],
        liveSessions: [
          { sessionId: 's-codex', isTurnStreaming: false, subagents: [] },
          { sessionId: 's-unknown', isTurnStreaming: false, subagents: [] },
        ],
      })
    );
    expect(summary.providerId).toBe('claude');
    expect(summary.liveSessions.map((session) => [session.sessionId, session.providerId])).toEqual([
      ['s-codex', 'codex'],
      ['s-unknown', null],
    ]);
  });

  // devstation-20r (product call 2026-10-04): the sidebar lists what runs now
  // in creation order, so a row never moves under the cursor when an agent
  // speaks; the rail's recency order (`session-row-presentation.ts`) is the
  // inventory of everything that ran. The sessions arrive from an unordered
  // query, so the order is the summary's to set, not the database's.
  it('lists live sessions oldest-created first, whatever their activity or arrival order', () => {
    const facts = (id: string, createdAt: number, lastActiveAt: number) => ({
      id,
      status: 'active',
      kind: 'chat',
      agentProviderId: 'claude',
      title: id,
      createdAt,
      lastActiveAt,
      lastTurnStatus: null,
    });
    const summary = buildWorktreeSummary(
      baseInput({
        sessions: [facts('s-third', 30, 31), facts('s-first', 10, 90), facts('s-second', 20, 60)],
        liveSessions: [
          { sessionId: 's-second', isTurnStreaming: false, subagents: [] },
          { sessionId: 's-third', isTurnStreaming: false, subagents: [] },
          { sessionId: 's-first', isTurnStreaming: true, subagents: [] },
        ],
      })
    );
    expect(summary.liveSessions.map((session) => session.sessionId)).toEqual([
      's-first',
      's-second',
      's-third',
    ]);
  });

  it('buckets needs_input over a streaming turn when a permission request is pending', () => {
    const summary = buildWorktreeSummary(
      baseInput({
        pendingPermissionRequests: 1,
        liveSessions: [{ sessionId: 's-1', isTurnStreaming: true, subagents: [] }],
      })
    );
    expect(summary.bucket).toBe('needs_input');
  });

  it("buckets failed when a session's last turn errored", () => {
    const summary = buildWorktreeSummary(
      baseInput({
        sessions: [
          {
            id: 's-1',
            status: 'active',
            kind: 'chat',
            agentProviderId: 'claude',
            title: null,
            createdAt: 1,
            lastActiveAt: 1,
            lastTurnStatus: 'error',
          },
        ],
      })
    );
    expect(summary.bucket).toBe('failed');
  });

  it('does not treat a completed turn (lastTurnStatus null) as failed', () => {
    const summary = buildWorktreeSummary(
      baseInput({
        sessions: [
          {
            id: 's-1',
            status: 'active',
            kind: 'chat',
            agentProviderId: 'claude',
            title: null,
            createdAt: 1,
            lastActiveAt: 1,
            lastTurnStatus: null,
          },
        ],
      })
    );
    expect(summary.bucket).toBe('idle');
  });

  it('buckets failed when gitOperationFailed is set, independent of sessions', () => {
    const summary = buildWorktreeSummary(baseInput({ gitOperationFailed: true }));
    expect(summary.bucket).toBe('failed');
  });
});

describe('attributePendingRequests', () => {
  it("attributes a request with a known session to that session's worktree", () => {
    const counts = attributePendingRequests(
      [{ workItemId: 'wi-1', sessionId: 's-1' }],
      new Map([['s-1', 'wt-secondary']]),
      new Map([['wi-1', 'wt-primary']])
    );
    expect(counts.get('wt-secondary')).toBe(1);
    expect(counts.has('wt-primary')).toBe(false);
  });

  it('falls back to the work item fallback when the session is unknown', () => {
    const counts = attributePendingRequests(
      [{ workItemId: 'wi-1', sessionId: null }],
      new Map(),
      new Map([['wi-1', 'wt-primary']])
    );
    expect(counts.get('wt-primary')).toBe(1);
  });

  it('drops a request whose work item has no fallback', () => {
    const counts = attributePendingRequests(
      [{ workItemId: 'wi-orphan', sessionId: null }],
      new Map(),
      new Map()
    );
    expect(counts.size).toBe(0);
  });
});

describe('computeUnread', () => {
  it('is never unread with no finished turn', () => {
    expect(computeUnread(null, undefined)).toBe(false);
    expect(computeUnread(null, 100)).toBe(false);
  });

  it('treats a missing lastViewedAt entry as unread when a turn exists', () => {
    expect(computeUnread(100, undefined)).toBe(true);
  });

  it('compares turn time against the last viewed time', () => {
    expect(computeUnread(100, 200)).toBe(false);
    expect(computeUnread(300, 200)).toBe(true);
  });
});

describe('two-worktree work item', () => {
  it('aggregates working from a streaming secondary and keeps primary first', () => {
    const primary = buildWorktreeSummary(
      baseInput({
        id: 'wt-primary',
        isPrimary: true,
        diffStats: { added: 12, removed: 4 },
      })
    );
    const secondary = buildWorktreeSummary(
      baseInput({
        id: 'wt-secondary',
        isPrimary: false,
        branch: 'feat/secondary',
        sessions: [
          {
            id: 's-secondary',
            status: 'active',
            kind: 'chat',
            agentProviderId: 'claude',
            title: 'secondary session',
            createdAt: 1,
            lastActiveAt: 1,
            lastTurnStatus: null,
          },
        ],
        liveSessions: [{ sessionId: 's-secondary', isTurnStreaming: true, subagents: [] }],
      })
    );

    const worktrees = [primary, secondary];
    expect(worktrees[0]!.isPrimary).toBe(true);
    expect(primary.bucket).toBe('idle');
    expect(secondary.bucket).toBe('working');

    const aggregate = deriveWorkItemStatus(
      worktrees.map((w) => w.bucket),
      { workItemStatus: 'active', pullRequest: null }
    );
    expect(aggregate).toBe('working');
  });
});
