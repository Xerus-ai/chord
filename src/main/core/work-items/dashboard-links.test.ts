import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Real SQLite from the shipped migrations, as in session-row-summaries.test.ts. */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const { db } = await import('@main/db/client');
const { repos, workItemTickets, workItems } = await import('@main/db/schema-work-items');
const { artifacts } = await import('@main/db/schema-artifacts');
const { readDashboardLinks } = await import('./dashboard-links');

beforeEach(async () => {
  await db.delete(artifacts);
  await db.delete(workItemTickets);
  await db.delete(workItems);
  await db.delete(repos);
  await db.insert(repos).values({ id: 'r-1', alias: 'chord', path: '/tmp/chord' });
  await db.insert(workItems).values([
    { id: 'w-1', repoId: 'r-1', repoPath: '/tmp/chord', name: 'Auth JWT migration' },
    { id: 'w-2', repoId: 'r-1', repoPath: '/tmp/chord2', name: 'Fix DB pool' },
    { id: 'w-3', repoId: 'r-1', repoPath: '/tmp/chord3', name: 'Not asked for' },
  ]);
});

async function addTicket(id: string, workItemId: string, ticketId: string, createdAt: number) {
  await db.insert(workItemTickets).values({
    id,
    workItemId,
    ticketId,
    ticketUrl: `https://linear.app/x/issue/${ticketId}`,
    ticketProvider: 'linear',
    createdAt,
  });
}

async function addArtifact(id: string, workItemId: string, name: string, createdAt: number) {
  await db.insert(artifacts).values({
    id,
    workItemId,
    filePath: `docs/${name}`,
    name,
    type: 'markdown',
    status: 'in_review',
    createdAt,
    updatedAt: createdAt,
  });
}

describe('readDashboardLinks', () => {
  it('groups tickets and artifacts under the item they belong to, oldest first', async () => {
    await addTicket('t-2', 'w-1', 'XER-343', 20);
    await addTicket('t-1', 'w-1', 'XER-342', 10);
    await addArtifact('a-1', 'w-1', 'auth-design-doc.md', 5);

    const links = await readDashboardLinks(['w-1', 'w-2']);

    expect(links['w-1']?.tickets.map((t) => t.ticketId)).toEqual(['XER-342', 'XER-343']);
    expect(links['w-1']?.tickets[0]?.ticketProvider).toBe('linear');
    expect(links['w-1']?.artifacts).toEqual([
      { id: 'a-1', name: 'auth-design-doc.md', type: 'markdown', status: 'in_review' },
    ]);
  });

  // Every requested item gets an entry, so the card can tell "has none" from
  // "not loaded" — an absent key would read as the latter.
  it('returns empty lists for a requested item with no links', async () => {
    const links = await readDashboardLinks(['w-2']);
    expect(links['w-2']).toEqual({ tickets: [], artifacts: [] });
  });

  it('never returns links for an item that was not requested', async () => {
    await addTicket('t-9', 'w-3', 'XER-999', 1);
    await addArtifact('a-9', 'w-3', 'other.md', 1);

    const links = await readDashboardLinks(['w-1']);

    expect(Object.keys(links)).toEqual(['w-1']);
  });

  it('returns an empty record for no ids', async () => {
    expect(await readDashboardLinks([])).toEqual({});
  });
});
