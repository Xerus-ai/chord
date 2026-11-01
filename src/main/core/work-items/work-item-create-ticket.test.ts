import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ok } from '@shared/result';
import { previewWorkItemBranch } from './preview-work-item-branch';
import { testDb } from './test-support/work-items-test-db';
import { createWorkItem } from './work-item-crud';

/**
 * One create request carries everything a work item starts with, including
 * its ticket (plan §Phase 3 slice 1). Over the same REAL database as
 * work-item-crud.test.ts (built from the shipped migrations):
 *   - the ticket row is written in the same transaction as the work item, so
 *     a failure can never leave an item named after a ticket it isn't linked to;
 *   - the name is stored exactly as the dialog showed it;
 *   - the branch the dialog previewed is the branch created: same name, same
 *     work item id (chosen by the dialog), same prefix resolution.
 * Only the worktree ENGINE and Electron-bound services are substituted, as in
 * the neighbouring suites.
 */
vi.mock('@main/db/client', async () => ({
  db: (await import('./test-support/work-items-test-db')).testDrizzle,
}));

vi.mock('./sync-queue-service', () => ({
  syncQueueService: { enqueueCreate: vi.fn(), enqueueUpdate: vi.fn(), enqueueDelete: vi.fn() },
}));

vi.mock('./git-state-capture', () => ({
  gitStateCaptureService: { kick: vi.fn() },
}));

vi.mock('@main/core/checkpoints/checkpoint-service', () => ({
  deleteWorkItemCheckpoints: vi.fn(),
}));

vi.mock('@main/core/settings/settings-service', () => ({
  appSettingsService: {
    get: (key: string) =>
      Promise.resolve(
        key === 'localProject'
          ? { branchPrefixMode: 'custom', branchPrefix: 'chord', branchPrefixUsername: null }
          : 'claude'
      ),
  },
}));

vi.mock('@main/lib/events', () => ({
  events: { emit: vi.fn() },
}));

vi.mock('@main/core/account/services/chord-account-service', () => ({
  chordAccountService: {
    getSession: () => Promise.resolve({ user: { userId: 'user-test-owner' } }),
    getCachedUserId: () => 'user-test-owner',
  },
}));
vi.mock('@main/db/kv', () => ({
  KV: class {
    get() {
      return Promise.resolve(null);
    }
    set() {
      return Promise.resolve();
    }
  },
}));

vi.mock('@main/core/worktrees/workspace-bridge', () => ({
  acquireWorktreeWorkspace: vi.fn(),
  releaseWorktreeWorkspace: vi.fn(),
}));

vi.mock('@main/core/worktrees/worktree-cloud-sync', () => ({
  scheduleWorktreeCloudSync: vi.fn(),
}));

const mockProvision = vi.fn();
const mockPreflight = vi.fn();
vi.mock('./work-item-worktree', () => ({
  provisionWorkItemWorktree: (...args: unknown[]) => mockProvision(...args),
  preflightWorkItemLane: (...args: unknown[]) => mockPreflight(...args),
}));

vi.mock('@main/core/worktrees/lane-setup', () => ({
  runLaneSetup: vi.fn(),
}));

const REPO_ROOT = 'C:\\repo\\root';
const LINEAR_URL = 'https://linear.app/acme/issue/ENG-42/fix-login-redirect';
const WORK_ITEM_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

function count(table: string): number {
  return (testDb.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;
}

function readTickets(workItemId: string): unknown[] {
  return testDb
    .prepare(
      `SELECT work_item_id, ticket_id, ticket_url, ticket_provider, ticket_title
       FROM work_item_tickets WHERE work_item_id = ?`
    )
    .all(workItemId)
    .map((row) => ({ ...(row as object) }));
}

describe('creating a work item with its ticket', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPreflight.mockResolvedValue(ok(undefined));
    // Provisioning is not under test: it stays in flight for the whole case.
    mockProvision.mockReturnValue(new Promise(() => {}));
    testDb.exec('DELETE FROM work_item_tickets');
    testDb.exec('DELETE FROM work_items');
  });

  afterEach(() => {
    testDb.exec('DROP TRIGGER IF EXISTS refuse_ticket_insert');
  });

  it('writes the ticket with the work item, named exactly as sent', async () => {
    const result = await createWorkItem({
      id: WORK_ITEM_ID,
      name: 'ENG-42 Fix login redirect',
      repoPath: REPO_ROOT,
      ticket: { provider: 'linear', id: 'ENG-42', url: LINEAR_URL, title: 'Fix login redirect' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.item.id).toBe(WORK_ITEM_ID);
    expect(result.data.item.name).toBe('ENG-42 Fix login redirect');
    // Present the instant create returns: no second call links it later.
    expect(readTickets(WORK_ITEM_ID)).toEqual([
      {
        work_item_id: WORK_ITEM_ID,
        ticket_id: 'ENG-42',
        ticket_url: LINEAR_URL,
        ticket_provider: 'linear',
        ticket_title: 'Fix login redirect',
      },
    ]);
  });

  it('keeps a key-only name, and a ticket with no title or URL, as sent', async () => {
    const result = await createWorkItem({
      id: WORK_ITEM_ID,
      name: 'ENG-42',
      repoPath: REPO_ROOT,
      ticket: { provider: 'jira', id: 'ENG-42', url: null, title: null },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.item.name).toBe('ENG-42');
    expect(readTickets(WORK_ITEM_ID)).toEqual([
      {
        work_item_id: WORK_ITEM_ID,
        ticket_id: 'ENG-42',
        ticket_url: null,
        ticket_provider: 'jira',
        ticket_title: null,
      },
    ]);
  });

  it('leaves no work item, lane or ticket when the ticket cannot be written', async () => {
    // A real SQLite failure on the ticket insert, inside createWorkItem's transaction.
    testDb.exec(
      `CREATE TRIGGER refuse_ticket_insert BEFORE INSERT ON work_item_tickets
       BEGIN SELECT RAISE(ABORT, 'ticket insert refused'); END`
    );

    await expect(
      createWorkItem({
        id: WORK_ITEM_ID,
        name: 'ENG-42 Fix login redirect',
        repoPath: REPO_ROOT,
        ticket: { provider: 'linear', id: 'ENG-42', url: LINEAR_URL, title: 'Fix login redirect' },
      })
    ).rejects.toThrow(/ticket insert refused/);

    expect(count('work_items')).toBe(0);
    expect(count('work_item_worktrees')).toBe(0);
    expect(count('work_item_tickets')).toBe(0);
    expect(mockProvision).not.toHaveBeenCalled();
  });

  it('refuses a ticket from an unknown provider, or with no id, before writing anything', async () => {
    const unknownProvider = await createWorkItem({
      name: 'x',
      repoPath: REPO_ROOT,
      // An IPC payload is untrusted: the type says three providers, the wire can say anything.
      ticket: { provider: 'other', id: 'X-1', url: null, title: null } as never,
    });
    const noId = await createWorkItem({
      name: 'y',
      repoPath: REPO_ROOT,
      ticket: { provider: 'github', id: '  ', url: null, title: null },
    });

    for (const result of [unknownProvider, noId]) {
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.type).toBe('invalid_request');
    }
    expect(count('work_items')).toBe(0);
    expect(count('work_item_tickets')).toBe(0);
  });

  it('creates the branch the dialog previewed for the same name and id', async () => {
    const preview = await previewWorkItemBranch({
      name: 'ENG-42 Fix login redirect',
      workItemId: WORK_ITEM_ID,
    });
    expect(preview).toEqual({
      success: true,
      data: { branchName: 'chord/eng-42-fix-login-redirect-3fa' },
    });

    const result = await createWorkItem({
      id: WORK_ITEM_ID,
      name: 'ENG-42 Fix login redirect',
      repoPath: REPO_ROOT,
      ticket: { provider: 'linear', id: 'ENG-42', url: LINEAR_URL, title: 'Fix login redirect' },
    });

    expect(result.success).toBe(true);
    if (!result.success || !preview.success) return;
    expect(result.data.item.branchName).toBe(preview.data.branchName);
  });

  it('refuses an id that already names a work item, writing nothing more', async () => {
    const first = await createWorkItem({ id: WORK_ITEM_ID, name: 'first', repoPath: REPO_ROOT });
    expect(first.success).toBe(true);

    const second = await createWorkItem({
      id: WORK_ITEM_ID,
      name: 'second',
      repoPath: REPO_ROOT,
      ticket: {
        provider: 'github',
        id: '7',
        url: 'https://github.com/acme/api/issues/7',
        title: 'T',
      },
    });

    expect(second.success).toBe(false);
    if (!second.success) expect(second.error.type).toBe('invalid_request');
    expect(count('work_items')).toBe(1);
    expect(count('work_item_tickets')).toBe(0);
  });

  it('refuses an id that is not a UUID', async () => {
    const result = await createWorkItem({ id: '../../etc', name: 'x', repoPath: REPO_ROOT });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('invalid_request');
    expect(count('work_items')).toBe(0);
  });
});
