import { describe, expect, it } from 'vitest';
import type { ConfluencePublicationStatus } from '@shared/confluence';
import { confluenceChip } from './confluence-chip';

const PAGE = {
  pageId: 'p1',
  pageUrl: 'https://acme.atlassian.net/wiki/p1',
  spaceKey: 'ENG',
  publishedArtifactVersion: 3,
  confluenceVersion: 7,
  remoteVersion: 7,
};

/**
 * The file bar's Confluence chip (shared-items design §5): once an artifact is
 * published, a status dot before the comments button; nothing before that.
 */
describe('confluenceChip', () => {
  it('shows nothing for an artifact that was never published, or not read yet', () => {
    expect(confluenceChip({ state: 'unpublished' })).toBeNull();
    expect(confluenceChip(null)).toBeNull();
  });

  it('is green while the page matches, amber when it is behind or was edited there', () => {
    const of = (state: 'published' | 'out_of_date' | 'edited_in_confluence') =>
      confluenceChip({ state, ...PAGE } as ConfluencePublicationStatus);
    expect(of('published')).toEqual({ tone: 'ok', title: 'Published to Confluence (v3)' });
    expect(of('out_of_date')).toEqual({
      tone: 'warn',
      title: 'Confluence is out of date (has v3)',
    });
    expect(of('edited_in_confluence')).toEqual({
      tone: 'warn',
      title: 'Edited in Confluence since v3',
    });
  });
});
