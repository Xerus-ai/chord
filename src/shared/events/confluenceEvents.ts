import type { ConfluencePublicationStatus } from '@shared/confluence';
import { defineEvent } from '@shared/ipc/events';

/**
 * An artifact's Confluence page was updated automatically ("Update the
 * Confluence page automatically"), or the attempt failed. Exactly one of
 * `status` and `error` is set.
 */
export interface ConfluencePublicationUpdate {
  artifactId: string;
  status?: ConfluencePublicationStatus;
  error?: string;
}

export const confluencePublicationChannel = defineEvent<ConfluencePublicationUpdate>(
  'confluence-publication-update'
);
