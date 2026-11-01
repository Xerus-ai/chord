import { asc, inArray } from 'drizzle-orm';
import type { DashboardLinksById } from '@shared/dashboard-links';
import { db } from '@main/db/client';
import { artifacts } from '@main/db/schema-artifacts';
import { workItemTickets } from '@main/db/schema-work-items';

/**
 * The tickets and artifacts behind every dashboard card, as two queries for
 * all cards (both tables are indexed on work_item_id). Kept out of the
 * sidebar summaries so the sidebar does not pay for facts it never shows, and
 * so a failure here costs the cards only these two facts.
 */
export async function readDashboardLinks(ids: string[]): Promise<DashboardLinksById> {
  if (ids.length === 0) return {};

  const [ticketRows, artifactRows] = await Promise.all([
    db
      .select({
        workItemId: workItemTickets.workItemId,
        ticketId: workItemTickets.ticketId,
        ticketUrl: workItemTickets.ticketUrl,
        ticketProvider: workItemTickets.ticketProvider,
      })
      .from(workItemTickets)
      .where(inArray(workItemTickets.workItemId, ids))
      .orderBy(asc(workItemTickets.createdAt)),
    db
      .select({
        workItemId: artifacts.workItemId,
        id: artifacts.id,
        name: artifacts.name,
        type: artifacts.type,
        status: artifacts.status,
      })
      .from(artifacts)
      .where(inArray(artifacts.workItemId, ids))
      .orderBy(asc(artifacts.createdAt)),
  ]);

  const links: DashboardLinksById = {};
  for (const id of ids) links[id] = { tickets: [], artifacts: [] };
  for (const { workItemId, ...ticket } of ticketRows) links[workItemId]?.tickets.push(ticket);
  for (const { workItemId, ...artifact } of artifactRows) {
    links[workItemId]?.artifacts.push(artifact);
  }
  return links;
}
