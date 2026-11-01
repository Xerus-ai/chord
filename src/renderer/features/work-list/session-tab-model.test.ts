import type { CloudSession, CloudWorktree } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import type { Worktree } from '@shared/worktrees';
import {
  cloudSessionTabModel,
  cloudSessionWorktrees,
  describeSessionHistory,
  describeSessionTab,
  findSessionWorktree,
} from './session-tab-model';

function worktree(id: string, branchName: string | null, isPrimary: boolean): Worktree {
  return {
    id,
    workItemId: 'wi',
    path: `/w/${id}`,
    branchName,
    baseBranch: null,
    targetRef: null,
    setupStatus: null,
    forkSource: null,
    checkoutOrigin: 'chord',
    isPrimary,
    title: null,
    createdAt: 1,
    archivedAt: null,
  };
}

const WORKTREES = [worktree('primary', 'feat/main', true), worktree('wt2', 'feat/tests', false)];

describe('findSessionWorktree', () => {
  it('maps a null worktree id to the primary', () => {
    expect(findSessionWorktree(WORKTREES, null)?.id).toBe('primary');
  });

  it('finds a secondary worktree by id', () => {
    expect(findSessionWorktree(WORKTREES, 'wt2')?.id).toBe('wt2');
  });
});

const IDLE = { isStreaming: false, hasPendingInput: false };
const STREAMING = { isStreaming: true, hasPendingInput: false };

describe('describeSessionTab', () => {
  const chat = {
    kind: 'chat',
    title: null,
    agentProviderId: 'claude',
    worktreeId: 'wt2',
    status: 'active',
  };

  it('labels an untitled chat by provider and reads its worktree branch', () => {
    expect(describeSessionTab(chat, WORKTREES, IDLE)).toEqual({
      label: 'Claude Code',
      kind: 'chat',
      providerId: 'claude',
      branch: 'feat/tests',
      lane: 'tests',
      statusBucket: 'idle',
    });
  });

  // devstation-5u6 / 6z9s: two tabs of one item on different lanes read alike
  // ("Command Prompt" twice, "Claude Code (fork)" twice) unless the lane shows.
  it('names the lane of a tab off the primary, and none on the primary', () => {
    const lanes = [
      worktree('primary', 'ada/fix-login', true),
      worktree('f', 'ada/fix-login--fork', false),
    ];
    expect(describeSessionTab({ ...chat, worktreeId: 'f' }, lanes, IDLE).lane).toBe('fork');
    expect(describeSessionTab({ ...chat, worktreeId: 'primary' }, lanes, IDLE).lane).toBeNull();
    expect(describeSessionTab({ ...chat, worktreeId: null }, lanes, IDLE).lane).toBeNull();
  });

  it('prefers the session title and reports streaming as working', () => {
    const d = describeSessionTab({ ...chat, title: 'Fix tests' }, WORKTREES, STREAMING);
    expect(d.label).toBe('Fix tests');
    expect(d.statusBucket).toBe('working');
  });

  it('reports an errored session as failed even while streaming', () => {
    expect(
      describeSessionTab({ ...chat, status: 'error' }, WORKTREES, STREAMING).statusBucket
    ).toBe('failed');
  });

  it('reports a pending request as needs_input over failed and working', () => {
    const pending = { isStreaming: true, hasPendingInput: true };
    expect(describeSessionTab(chat, WORKTREES, pending).statusBucket).toBe('needs_input');
    expect(describeSessionTab({ ...chat, status: 'error' }, WORKTREES, pending).statusBucket).toBe(
      'needs_input'
    );
  });

  it('describes a terminal without a provider', () => {
    const d = describeSessionTab(
      { ...chat, kind: 'terminal', agentProviderId: null, worktreeId: null },
      undefined,
      IDLE
    );
    expect(d).toMatchObject({ label: 'Terminal', providerId: null, branch: null });
  });

  // devstation-jop: + menu › Claude Code with Open agents in = Terminal.
  it('names an agent terminal after its agent, and keeps the terminal icon', () => {
    for (const [agentProviderId, label] of [
      ['claude', 'Claude Code'],
      ['codex', 'Codex'],
    ] as const) {
      const d = describeSessionTab(
        { ...chat, kind: 'terminal', agentProviderId, title: null },
        WORKTREES,
        IDLE
      );
      expect(d).toMatchObject({ label, kind: 'terminal', providerId: null, branch: 'feat/tests' });
    }
  });
});

// Plan §"Decisions for Phase 5", Visibility: Reset and Fork need the agent's
// own conversation, which a terminal chat does not give Chord.
describe('describeSessionHistory', () => {
  it("says an agent terminal's history is unavailable", () => {
    expect(describeSessionHistory({ kind: 'terminal', agentProviderId: 'claude' })).toBe(
      'History unavailable for terminal chats'
    );
  });

  it('says nothing for a chat or a plain terminal', () => {
    expect(describeSessionHistory({ kind: 'chat', agentProviderId: 'claude' })).toBeNull();
    expect(describeSessionHistory({ kind: 'terminal', agentProviderId: null })).toBeNull();
  });
});

/**
 * A teammate's sessions come from the cloud registry (shared-items step 4,
 * decision 5): the same tab, described by the same function, from a cloud
 * row. Cloud sessions are chats; terminals are never published.
 */
describe('cloudSessionTabModel', () => {
  const cloudSession: CloudSession = {
    id: 's-1',
    work_item_id: 'wi-1',
    agent_provider_id: 'claude',
    title: null,
    status: 'active',
    worktree_id: 'wt-2',
    last_active_at: '2026-09-28T10:00:00.000Z',
  } as CloudSession;

  it('is a chat tab with the row’s provider, title, worktree and status', () => {
    expect(cloudSessionTabModel(cloudSession)).toEqual({
      id: 's-1',
      workItemId: 'wi-1',
      kind: 'chat',
      title: null,
      agentProviderId: 'claude',
      worktreeId: 'wt-2',
      status: 'active',
    });
  });

  it('is described like a local session, its branch from the cloud worktrees', () => {
    const worktrees = cloudSessionWorktrees([
      { id: 'wt-1', branch_name: 'main', is_primary: true },
      { id: 'wt-2', branch_name: 'kai/checkout', is_primary: false },
    ] as CloudWorktree[]);
    expect(
      describeSessionTab(cloudSessionTabModel(cloudSession), worktrees, {
        isStreaming: false,
        hasPendingInput: false,
      })
    ).toEqual({
      label: 'Claude Code',
      kind: 'chat',
      providerId: 'claude',
      branch: 'kai/checkout',
      lane: 'checkout',
      statusBucket: 'idle',
    });
  });
});
