import type { ConfluencePublicationStatus } from '@shared/confluence';

/**
 * The file bar's Confluence chip (shared-items design §5): once an artifact
 * is published, a status dot before 💬, green while the page matches, amber
 * when it is behind or was edited there. Nothing before the first publish.
 */
export function confluenceChip(
  status: ConfluencePublicationStatus | null
): { tone: 'ok' | 'warn'; title: string } | null {
  if (status === null) return null;
  switch (status.state) {
    case 'unpublished':
      return null;
    case 'published':
      return {
        tone: 'ok',
        title: `Published to Confluence (v${status.publishedArtifactVersion})`,
      };
    case 'out_of_date':
      return {
        tone: 'warn',
        title: `Confluence is out of date (has v${status.publishedArtifactVersion})`,
      };
    case 'edited_in_confluence':
      return {
        tone: 'warn',
        title: `Edited in Confluence since v${status.publishedArtifactVersion}`,
      };
  }
}
