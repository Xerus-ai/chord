/**
 * How the rail's Tickets section names a linked ticket: by the title stored at
 * create (`work_item_tickets.ticket_title`, migration 0051), with its key and
 * provider as meta. A link with no stored title — made before 0051, or by
 * hand — is named by its key, the only name it has.
 */
export function describeTicketRow(ticket: {
  ticketId: string;
  ticketTitle: string | null;
  ticketProvider: string | null;
}): { title: string; meta: string } {
  const provider = ticket.ticketProvider ?? 'Ticket';
  if (!ticket.ticketTitle) return { title: ticket.ticketId, meta: provider };
  return { title: ticket.ticketTitle, meta: `${ticket.ticketId} · ${provider}` };
}
