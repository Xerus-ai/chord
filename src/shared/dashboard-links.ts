/** A ticket linked to a work item, as a dashboard card prints it. */
export interface DashboardTicketLink {
  ticketId: string;
  ticketUrl: string | null;
  /** `work_item_tickets.ticket_provider` — 'linear' | 'jira' | 'github'. */
  ticketProvider: string;
}

/** An artifact on a work item, as the card's artifact list prints it. */
export interface DashboardArtifactLink {
  id: string;
  name: string;
  type: string;
  status: string;
}

export interface DashboardLinks {
  tickets: DashboardTicketLink[];
  artifacts: DashboardArtifactLink[];
}

/**
 * Tickets and artifacts per work item id. Every requested id has an entry,
 * so an item with none (empty lists) is distinguishable from one that was
 * never loaded (no key).
 */
export type DashboardLinksById = Record<string, DashboardLinks>;
