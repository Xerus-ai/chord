import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createRPCController } from '@shared/ipc/rpc';
import { err, ok } from '@shared/result';
import { db } from '@main/db/client';
import { workItemTickets } from '@main/db/schema-work-items';

export const workItemTicketsController = createRPCController({
  getTickets: async (workItemId: string) => {
    const rows = await db
      .select()
      .from(workItemTickets)
      .where(eq(workItemTickets.workItemId, workItemId));
    return ok({ tickets: rows });
  },

  addTicket: async (args: {
    workItemId: string;
    ticketId: string;
    ticketUrl?: string;
    ticketProvider: string;
  }) => {
    const id = randomUUID();
    const now = Math.floor(Date.now() / 1000);

    await db.insert(workItemTickets).values({
      id,
      workItemId: args.workItemId,
      ticketId: args.ticketId,
      ticketUrl: args.ticketUrl ?? null,
      ticketProvider: args.ticketProvider,
      createdAt: now,
    });

    // Read back what was actually persisted rather than echoing the input:
    // callers (link-issue-modal) report the link as done off this Result, so
    // a row that isn't there must surface as a failure, not a fabricated
    // success.
    const [row] = await db
      .select()
      .from(workItemTickets)
      .where(eq(workItemTickets.id, id))
      .limit(1);
    if (!row) return err(`ticket link ${args.ticketId} was not persisted`);
    return ok({ ticket: row });
  },

  removeTicket: async (id: string) => {
    await db.delete(workItemTickets).where(eq(workItemTickets.id, id));
    return ok();
  },
});
