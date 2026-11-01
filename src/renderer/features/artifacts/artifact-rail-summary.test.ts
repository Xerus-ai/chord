import { describe, expect, it } from 'vitest';
import { mergeArtifactRailSummaries } from './artifact-rail-summary';

/**
 * The rail's counts (shared-items step 1, S8) come from two stores: an
 * artifact that reached the cloud has its comments there (with the caller's
 * unread state), one that never synced keeps them on this device and is never
 * unread. Versions are always the device's, as the Versions card reads them.
 */
describe('mergeArtifactRailSummaries', () => {
  const artifacts = [
    { id: 'synced', cloudId: 'synced' },
    { id: 'local-only', cloudId: null },
    { id: 'no-rows', cloudId: null },
  ];
  const local = [
    { artifactId: 'synced', openComments: 9, latestVersion: 5 },
    { artifactId: 'local-only', openComments: 2, latestVersion: 1 },
  ];
  const cloud = [
    { artifact_id: 'synced', open_comments: 3, unread: true, latest_version: 2 },
    { artifact_id: 'local-only', open_comments: 7, unread: true, latest_version: 7 },
  ];

  it('takes a synced artifact’s comments from the cloud and its version from the device', () => {
    const merged = mergeArtifactRailSummaries({ artifacts, local, cloud, signedIn: true });

    expect(merged.get('synced')).toEqual({
      comments: { open: 3, unread: true },
      latestVersion: 5,
    });
  });

  it('takes an unsynced artifact’s comments from the device, never unread', () => {
    const merged = mergeArtifactRailSummaries({ artifacts, local, cloud, signedIn: true });

    expect(merged.get('local-only')).toEqual({
      comments: { open: 2, unread: false },
      latestVersion: 1,
    });
  });

  it('reads every artifact from the device when signed out', () => {
    const merged = mergeArtifactRailSummaries({
      artifacts,
      local,
      cloud: undefined,
      signedIn: false,
    });

    expect(merged.get('synced')).toEqual({
      comments: { open: 9, unread: false },
      latestVersion: 5,
    });
  });

  it('shows no comment count for a synced artifact until the cloud answers', () => {
    const merged = mergeArtifactRailSummaries({
      artifacts,
      local,
      cloud: undefined,
      signedIn: true,
    });

    expect(merged.get('synced')).toEqual({ comments: null, latestVersion: 5 });
    expect(merged.get('local-only')).toEqual({
      comments: { open: 2, unread: false },
      latestVersion: 1,
    });
  });

  it('shows no comment count for a synced artifact the cloud summary does not list', () => {
    const merged = mergeArtifactRailSummaries({
      artifacts,
      local,
      cloud: cloud.filter((row) => row.artifact_id !== 'synced'),
      signedIn: true,
    });

    expect(merged.get('synced')).toEqual({ comments: null, latestVersion: 5 });
  });

  it('shows nothing for an artifact the local summary does not list yet', () => {
    const merged = mergeArtifactRailSummaries({ artifacts, local, cloud, signedIn: true });

    // The local read lists every artifact of the work item; a missing row is
    // a list newer than the summary, not an artifact with no comments.
    expect(merged.get('no-rows')).toEqual({ comments: null, latestVersion: null });
  });
});
