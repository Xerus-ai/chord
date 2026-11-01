import { describe, expect, it } from 'vitest';
import { describeTicketRow } from './ticket-row';

/**
 * A linked ticket reads as the user named it at create: its title, with the
 * key and provider beside it (devstation-096). The title is stored since
 * migration 0051; a link made before that, or by hand, has none.
 */
describe('describeTicketRow', () => {
  it('shows the stored title, with the key and provider as meta', () => {
    expect(
      describeTicketRow({
        ticketId: 'ENG-42',
        ticketTitle: 'Fix login redirect',
        ticketProvider: 'linear',
      })
    ).toEqual({ title: 'Fix login redirect', meta: 'ENG-42 · linear' });
  });

  it('a ticket with no stored title shows its key as the title', () => {
    expect(
      describeTicketRow({ ticketId: '2', ticketTitle: null, ticketProvider: 'github' })
    ).toEqual({ title: '2', meta: 'github' });
  });

  it('a ticket with no provider names it a Ticket', () => {
    expect(
      describeTicketRow({ ticketId: 'X-1', ticketTitle: 'Do it', ticketProvider: null })
    ).toEqual({ title: 'Do it', meta: 'X-1 · Ticket' });
  });
});
