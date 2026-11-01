import type { ConfluencePublicationStatus } from '@shared/confluence';

export type ConfluencePublishAction =
  | 'connect'
  | 'retry'
  | 'publish'
  | 'open'
  | 'update'
  | 'overwrite';

export interface ConfluencePublishState {
  kind:
    | 'checking'
    | 'policy_off'
    | 'not_connected'
    | 'failed'
    | 'unpublished'
    | 'published'
    | 'out_of_date'
    | 'edited';
  label: string;
  /** The status dot: in sync, behind or edited there, failed; none otherwise. */
  tone: 'ok' | 'warn' | 'err' | null;
  /** The row's main action; `overwrite` is styled as a danger. */
  action: ConfluencePublishAction | null;
}

/**
 * The Publish tab's Confluence row (shared-items design §5): what it says and
 * offers. `null` inputs are still being read. The team's policy comes first:
 * there is no point connecting a device to publish what may not be published.
 */
export function describeConfluencePublish(input: {
  connected: boolean | null;
  policyAllows: boolean | null;
  failure: string | null;
  status: ConfluencePublicationStatus | null;
}): ConfluencePublishState {
  if (input.policyAllows === null || input.connected === null) {
    return { kind: 'checking', label: 'Checking Confluence…', tone: null, action: null };
  }
  if (!input.policyAllows) {
    return {
      kind: 'policy_off',
      label: "Your team doesn't allow publishing to Confluence",
      tone: null,
      action: null,
    };
  }
  if (!input.connected) {
    return {
      kind: 'not_connected',
      label: 'Not connected on this device',
      tone: null,
      action: 'connect',
    };
  }
  if (input.failure !== null) {
    return {
      kind: 'failed',
      label: `Publish failed: ${input.failure}`,
      tone: 'err',
      action: 'retry',
    };
  }
  const status = input.status;
  if (status === null) {
    return { kind: 'checking', label: 'Checking Confluence…', tone: null, action: null };
  }
  switch (status.state) {
    case 'unpublished':
      return { kind: 'unpublished', label: 'Not published', tone: null, action: 'publish' };
    case 'published':
      return {
        kind: 'published',
        label: `Published v${status.publishedArtifactVersion}`,
        tone: 'ok',
        action: 'open',
      };
    case 'out_of_date':
      return {
        kind: 'out_of_date',
        label: `Out of date: Confluence has v${status.publishedArtifactVersion}`,
        tone: 'warn',
        action: 'update',
      };
    case 'edited_in_confluence':
      return {
        kind: 'edited',
        label: `Edited in Confluence since v${status.publishedArtifactVersion}`,
        tone: 'warn',
        action: 'overwrite',
      };
  }
}
