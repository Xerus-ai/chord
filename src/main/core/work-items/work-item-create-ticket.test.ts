import fs from 'node:fs';
import { sql } from 'drizzle-orm';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@main/db/client';
import { workItemTickets } from '@main/db/schema-work-items';
import { previewWorkItemBranch } from './preview-work-item-branch';
import {
  closeWorkItemRepo,
  createWorkItemTemplate,
  lanePoolPath,
  openWorkItemRepo,
  removeWorkItemTemplate,
  rowCount,
  type WorkItemRepo,
} from './test-support/work-item-harness';
import { createWorkItem } from './work-item-crud';

/**
 * A work item created with its ticket, on the real stack
 * (`test-support/work-item-harness.ts`): the ticket row is written in the same
 * transaction as the work item and its primary lane, named exactly as the
 * dialog sent it. Provisioning runs for real behind each create; the harness
 * waits for it before the repository goes. Only Electron's keychain and the
 * database handle are supplied.
 */
vi.mock('electron', async () => {
  const { electronWithTestKeychain } = await import('@main/core/account/_testing/test-keychain');
  return electronWithTestKeychain();
});
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const WORK_ITEM_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const LINEAR_URL = 'https://linear.app/acme/issue/ENG-42/fix-login-redirect';

let template: string;
let repo: WorkItemRepo;

function readTickets(workItemId: string) {
  return db
    .select({
      workItemId: workItemTickets.workItemId,
      ticketId: workItemTickets.ticketId,
      ticketUrl: workItemTickets.ticketUrl,
      ticketProvider: workItemTickets.ticketProvider,
      ticketTitle: workItemTickets.ticketTitle,
    })
    .from(workItemTickets)
    .where(sql`${workItemTickets.workItemId} = ${workItemId}`)
    .all();
}

beforeAll(async () => {
  template = await createWorkItemTemplate();
});

afterAll(() => {
  removeWorkItemTemplate(template);
});

beforeEach(async () => {
  repo = await openWorkItemRepo(template, 'work-item-ticket-');
});

afterEach(async () => {
  db.run(sql.raw('DROP TRIGGER IF EXISTS refuse_ticket_insert'));
  await closeWorkItemRepo(repo);
});

describe('creating a work item with its ticket', () => {
  it('writes the ticket with the work item, named exactly as sent', async () => {
    const result = await createWorkItem({
      id: WORK_ITEM_ID,
      name: 'ENG-42 Fix login redirect',
      repoPath: repo.repoDir,
      ticket: { provider: 'linear', id: 'ENG-42', url: LINEAR_URL, title: 'Fix login redirect' },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.item.id).toBe(WORK_ITEM_ID);
    expect(result.data.item.name).toBe('ENG-42 Fix login redirect');
    // Present the instant create returns: no second call links it later.
    expect(readTickets(WORK_ITEM_ID)).toEqual([
      {
        workItemId: WORK_ITEM_ID,
        ticketId: 'ENG-42',
        ticketUrl: LINEAR_URL,
        ticketProvider: 'linear',
        ticketTitle: 'Fix login redirect',
      },
    ]);
  });

  it('keeps a key-only name, and a ticket with no title or URL, as sent', async () => {
    const result = await createWorkItem({
      id: WORK_ITEM_ID,
      name: 'ENG-42',
      repoPath: repo.repoDir,
      ticket: { provider: 'jira', id: 'ENG-42', url: null, title: null },
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.item.name).toBe('ENG-42');
    expect(readTickets(WORK_ITEM_ID)).toEqual([
      {
        workItemId: WORK_ITEM_ID,
        ticketId: 'ENG-42',
        ticketUrl: null,
        ticketProvider: 'jira',
        ticketTitle: null,
      },
    ]);
  });

  it('leaves no work item, lane or ticket when the ticket cannot be written', async () => {
    // A real SQLite failure on the ticket insert, inside createWorkItem's transaction.
    db.run(
      sql.raw(`CREATE TRIGGER refuse_ticket_insert BEFORE INSERT ON work_item_tickets
       BEGIN SELECT RAISE(ABORT, 'ticket insert refused'); END`)
    );

    await expect(
      createWorkItem({
        id: WORK_ITEM_ID,
        name: 'ENG-42 Fix login redirect',
        repoPath: repo.repoDir,
        ticket: { provider: 'linear', id: 'ENG-42', url: LINEAR_URL, title: 'Fix login redirect' },
      })
    ).rejects.toThrow(/ticket insert refused/);

    expect(rowCount('work_items')).toBe(0);
    expect(rowCount('work_item_worktrees')).toBe(0);
    expect(rowCount('work_item_tickets')).toBe(0);
    // Nothing was provisioned for it: no checkout was started in the pool.
    expect(fs.existsSync(lanePoolPath(repo))).toBe(false);
  });

  it('refuses a ticket from an unknown provider, or with no id, before writing anything', async () => {
    const unknownProvider = await createWorkItem({
      name: 'x',
      repoPath: repo.repoDir,
      // An IPC payload is untrusted: the type says three providers, the wire can say anything.
      ticket: { provider: 'other', id: 'X-1', url: null, title: null } as never,
    });
    const noId = await createWorkItem({
      name: 'y',
      repoPath: repo.repoDir,
      ticket: { provider: 'github', id: '  ', url: null, title: null },
    });

    for (const result of [unknownProvider, noId]) {
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.type).toBe('invalid_request');
    }
    expect(rowCount('work_items')).toBe(0);
    expect(rowCount('work_item_tickets')).toBe(0);
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
      repoPath: repo.repoDir,
      ticket: { provider: 'linear', id: 'ENG-42', url: LINEAR_URL, title: 'Fix login redirect' },
    });

    expect(result.success).toBe(true);
    if (!result.success || !preview.success) return;
    expect(result.data.item.branchName).toBe(preview.data.branchName);
  });

  it('refuses an id that already names a work item, writing nothing more', async () => {
    const first = await createWorkItem({ id: WORK_ITEM_ID, name: 'first', repoPath: repo.repoDir });
    expect(first.success).toBe(true);

    const second = await createWorkItem({
      id: WORK_ITEM_ID,
      name: 'second',
      repoPath: repo.repoDir,
      ticket: {
        provider: 'github',
        id: '7',
        url: 'https://github.com/acme/api/issues/7',
        title: 'T',
      },
    });

    expect(second.success).toBe(false);
    if (!second.success) expect(second.error.type).toBe('invalid_request');
    expect(rowCount('work_items')).toBe(1);
    expect(rowCount('work_item_tickets')).toBe(0);
  });

  it('refuses an id that is not a UUID', async () => {
    const result = await createWorkItem({ id: '../../etc', name: 'x', repoPath: repo.repoDir });

    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.type).toBe('invalid_request');
    expect(rowCount('work_items')).toBe(0);
  });
});
