import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import type { CloudWorkItem } from '@renderer/lib/cloud-api';
import { splitSharedRows } from './shared-rows';

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

const SHARED_ITEM = { id: 'wi-2', access_scope: 'work_item' } as CloudWorkItem;

/**
 * The shared-with-me listing holds two kinds of row (shared-items step 3).
 * The sidebar holds each work item's room, where live updates arrive; an item
 * reached only through its artifacts would be refused that room, so it holds
 * the artifacts' rooms instead.
 */
describe('splitSharedRows', () => {
  it('parts work items from items reached only through artifacts', () => {
    const split = splitSharedRows([SHARED_ITEM, ARTIFACTS_ONLY]);
    expect(split.workItems).toEqual([SHARED_ITEM]);
    expect(split.artifactsOnly).toEqual([ARTIFACTS_ONLY]);
  });

  it("holds a work item's room, and an artifact-only item's artifact rooms", () => {
    const split = splitSharedRows([SHARED_ITEM, ARTIFACTS_ONLY]);
    expect(split.workItemRoomIds).toEqual(['wi-2']);
    expect(split.artifactRoomIds).toEqual(['art-1', 'art-2']);
  });
});
