import { describe, expect, it } from 'vitest';
import type { ConfluencePublicationStatus } from '@shared/confluence';
import { describeConfluencePublish } from './confluence-publish-state';

const PAGE = {
  pageId: 'p1',
  pageUrl: 'https://acme.atlassian.net/wiki/p1',
  spaceKey: 'ENG',
  publishedArtifactVersion: 3,
  confluenceVersion: 7,
  remoteVersion: 7,
};

const READY = { connected: true, policyAllows: true, failure: null } as const;
const status = (state: 'published' | 'out_of_date' | 'edited_in_confluence') =>
  ({ state, ...PAGE }) as ConfluencePublicationStatus;

/**
 * The Publish tab's Confluence row (shared-items design §5, table): what it
 * says and what it offers, in each state.
 */
describe('describeConfluencePublish', () => {
  it('waits while the connection or the policy is still being read', () => {
    expect(describeConfluencePublish({ ...READY, connected: null, status: null }).kind).toBe(
      'checking'
    );
    expect(describeConfluencePublish({ ...READY, policyAllows: null, status: null }).kind).toBe(
      'checking'
    );
  });

  it("says the team doesn't allow it, and offers nothing", () => {
    expect(describeConfluencePublish({ ...READY, policyAllows: false, status: null })).toEqual({
      kind: 'policy_off',
      label: "Your team doesn't allow publishing to Confluence",
      tone: null,
      action: null,
    });
  });

  it('offers to connect a device that is not connected', () => {
    expect(describeConfluencePublish({ ...READY, connected: false, status: null })).toEqual({
      kind: 'not_connected',
      label: 'Not connected on this device',
      tone: null,
      action: 'connect',
    });
  });

  it("shows the server's reason for a failure, and Retry", () => {
    expect(
      describeConfluencePublish({ ...READY, failure: 'Space ENG not found', status: null })
    ).toEqual({
      kind: 'failed',
      label: 'Publish failed: Space ENG not found',
      tone: 'err',
      action: 'retry',
    });
  });

  it('offers to publish an artifact that is not published', () => {
    expect(describeConfluencePublish({ ...READY, status: { state: 'unpublished' } })).toEqual({
      kind: 'unpublished',
      label: 'Not published',
      tone: null,
      action: 'publish',
    });
  });

  it('names the published version and opens the page', () => {
    expect(describeConfluencePublish({ ...READY, status: status('published') })).toEqual({
      kind: 'published',
      label: 'Published v3',
      tone: 'ok',
      action: 'open',
    });
  });

  it('offers to update a page that is out of date', () => {
    expect(describeConfluencePublish({ ...READY, status: status('out_of_date') })).toEqual({
      kind: 'out_of_date',
      label: 'Out of date: Confluence has v3',
      tone: 'warn',
      action: 'update',
    });
  });

  it('offers to overwrite edits made in Confluence, as a danger', () => {
    expect(describeConfluencePublish({ ...READY, status: status('edited_in_confluence') })).toEqual(
      {
        kind: 'edited',
        label: 'Edited in Confluence since v3',
        tone: 'warn',
        action: 'overwrite',
      }
    );
  });

  it('waits for the status once connected and allowed', () => {
    expect(describeConfluencePublish({ ...READY, status: null }).kind).toBe('checking');
  });
});
