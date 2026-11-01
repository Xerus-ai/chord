import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import type { WorkItemRow } from '@main/db/schema-work-items';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import {
  decideWorkItemResolution,
  type WorkItemResolutionInput,
} from './work-item-resolution-state';

const LOCAL_ITEM = { id: 'wi-1', name: 'testing', repoPath: 'D:/repo' } as WorkItemRow;
const CLOUD_ITEM = { id: 'wi-1', title: 'testing' } as unknown as CloudWorkItem;
const ARTIFACTS_ONLY: ArtifactsOnlyWorkItem = {
  access_scope: 'artifacts',
  id: 'wi-1',
  org_id: 'org-1',
  name: 'Landing page copy',
  status: 'active',
  repo_name: 'marketing-site',
  repo_remote_url: null,
  updated_at: '2026-09-27T10:00:00.000Z',
  version_number: 3,
  creator_id: 'u-raghav',
  creator_name: 'Raghav',
  creator_email: 'raghav@example.com',
  creator_avatar_url: null,
  shared_artifacts: [
    { id: 'art-1', name: 'pricing-spec.md' },
    { id: 'art-2', name: 'hero.html' },
  ],
};

function inputs(overrides: Partial<WorkItemResolutionInput> = {}): WorkItemResolutionInput {
  return {
    workItemId: 'wi-1',
    localItem: undefined,
    localListSettled: true,
    isDeleted: false,
    sessionPending: false,
    isSignedIn: true,
    cloud: { kind: 'pending' },
    retry: () => {},
    ...overrides,
  };
}

describe('decideWorkItemResolution', () => {
  it('resolves an item reached only through artifacts shared alone as artifacts_only', () => {
    // Its header is all there is: its chat and git state answer 403, so it must
    // never reach the cloud branch that reads them.
    const resolution = decideWorkItemResolution(
      inputs({ cloud: { kind: 'loaded', item: ARTIFACTS_ONLY } })
    );
    expect(resolution).toEqual({ kind: 'artifacts_only', item: ARTIFACTS_ONLY });
  });

  it('holds at loading while the local list has not been read for this id', () => {
    // The regression: a work item created a moment ago is not in a list that
    // was fetched before it existed. Reporting the cloud's answer here is what
    // showed the owner "This work item doesn't exist".
    const resolution = decideWorkItemResolution(
      inputs({ localListSettled: false, cloud: { kind: 'failed', status: 404 } })
    );
    expect(resolution.kind).toBe('loading');
  });

  it('resolves local once the id turns up in the list, despite a cached 404', () => {
    const resolution = decideWorkItemResolution(
      inputs({ localItem: LOCAL_ITEM, cloud: { kind: 'failed', status: 404 } })
    );
    expect(resolution).toEqual({ kind: 'local', item: LOCAL_ITEM });
  });

  it('never hands an owned item to the cloud branch', () => {
    const resolution = decideWorkItemResolution(
      inputs({ localItem: LOCAL_ITEM, cloud: { kind: 'loaded', item: CLOUD_ITEM } })
    );
    expect(resolution).toEqual({ kind: 'local', item: LOCAL_ITEM });
  });

  it('reports not_found only for a settled miss the cloud also denies', () => {
    const resolution = decideWorkItemResolution(inputs({ cloud: { kind: 'failed', status: 404 } }));
    expect(resolution.kind).toBe('not_found');
  });

  it('maps the remaining cloud statuses to their terminal states', () => {
    expect(decideWorkItemResolution(inputs({ cloud: { kind: 'failed', status: 403 } })).kind).toBe(
      'no_access'
    );
    expect(decideWorkItemResolution(inputs({ cloud: { kind: 'failed', status: 401 } })).kind).toBe(
      'signed_out'
    );
    expect(decideWorkItemResolution(inputs({ cloud: { kind: 'failed', status: 500 } })).kind).toBe(
      'error'
    );
    expect(decideWorkItemResolution(inputs({ cloud: { kind: 'failed', status: null } })).kind).toBe(
      'error'
    );
  });

  it('resolves a settled miss that the cloud does have', () => {
    const resolution = decideWorkItemResolution(
      inputs({ cloud: { kind: 'loaded', item: CLOUD_ITEM } })
    );
    expect(resolution).toEqual({ kind: 'cloud', item: CLOUD_ITEM });
  });

  it('keeps a live delete terminal without consulting the cloud', () => {
    const resolution = decideWorkItemResolution(
      inputs({ isDeleted: true, cloud: { kind: 'loaded', item: CLOUD_ITEM } })
    );
    expect(resolution.kind).toBe('deleted');
  });

  it('waits for the session before deciding a signed-out state', () => {
    expect(decideWorkItemResolution(inputs({ sessionPending: true })).kind).toBe('loading');
    expect(decideWorkItemResolution(inputs({ isSignedIn: false })).kind).toBe('signed_out');
  });

  it('reports loading when no id is requested', () => {
    expect(decideWorkItemResolution(inputs({ workItemId: null })).kind).toBe('loading');
  });
});
