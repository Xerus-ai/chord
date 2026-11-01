import type { ArtifactsOnlyWorkItem } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import { openArtifactsOnlyTarget } from './open-artifacts-only';

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

/**
 * Where an item reached only through artifacts shared alone opens (step 4,
 * S9): the work item, scoped to those artifacts, with the artifact as a tab.
 */
describe('openArtifactsOnlyTarget', () => {
  it('opens the work item on the artifact asked for', () => {
    expect(openArtifactsOnlyTarget(ARTIFACTS_ONLY, 'art-2')).toEqual({
      view: 'work-list',
      params: {
        workItemId: 'wi-1',
        openArtifact: { workItemId: 'wi-1', artifactId: 'art-2', title: 'hero.html' },
      },
    });
  });

  it('opens the first shared artifact when none is asked for', () => {
    expect(openArtifactsOnlyTarget(ARTIFACTS_ONLY, null)).toEqual({
      view: 'work-list',
      params: {
        workItemId: 'wi-1',
        openArtifact: { workItemId: 'wi-1', artifactId: 'art-1', title: 'pricing-spec.md' },
      },
    });
  });

  it('refuses an artifact the item does not share', () => {
    expect(() => openArtifactsOnlyTarget(ARTIFACTS_ONLY, 'art-9')).toThrow(/art-9/);
  });
});
