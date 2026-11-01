import type { CloudGitFileMeta } from '@chord/protocol';
import { describe, expect, it } from 'vitest';
import { CloudApiError } from '@renderer/lib/cloud-fetch';
import { cloudDiffContent } from './cloud-diff-content';

/**
 * A teammate's diff reads one file of the owner's pushed snapshot (moved from
 * participant-diff-viewer.tsx, shared-items step 4 S4). Contents that were
 * not synced never mount Monaco: a truncated original would make a garbage
 * diff that looks authoritative.
 */
const META: CloudGitFileMeta = {
  path: 'src/app.ts',
  status: 'modified',
  additions: 3,
  deletions: 1,
  content_omitted: false,
} as CloudGitFileMeta;

const GONE = {
  kind: 'notice',
  title: "No longer in the owner's changes",
  description:
    "This file isn't part of the latest synced snapshot. It may have been committed or reverted.",
};

describe('cloudDiffContent', () => {
  it('says the file left the snapshot when its meta is gone', () => {
    expect(
      cloudDiffContent({ meta: undefined, pending: false, error: null, data: undefined })
    ).toEqual(GONE);
  });

  it('says the contents were not synced, without loading them', () => {
    expect(
      cloudDiffContent({
        meta: { ...META, content_omitted: true },
        pending: true,
        error: null,
        data: undefined,
      })
    ).toEqual({
      kind: 'notice',
      title: 'Content not synced',
      description:
        "The owner's sync includes this file's stats only — its contents were too large, binary, or withheld by the sharing level.",
    });
  });

  it('is loading while the contents load', () => {
    expect(cloudDiffContent({ meta: META, pending: true, error: null, data: undefined })).toEqual({
      kind: 'loading',
    });
  });

  it('reads a 404 as the file having left the snapshot, any other error as a failure', () => {
    expect(
      cloudDiffContent({
        meta: META,
        pending: false,
        error: new CloudApiError(404, 'gone'),
        data: undefined,
      })
    ).toEqual(GONE);
    expect(
      cloudDiffContent({ meta: META, pending: false, error: new Error('boom'), data: undefined })
    ).toEqual({ kind: 'failed' });
  });

  it('is the two sides once loaded, with unchanged regions folded', () => {
    expect(
      cloudDiffContent({
        meta: META,
        pending: false,
        error: null,
        data: { path: 'src/app.ts', original: 'a', modified: 'b' },
      })
    ).toEqual({ kind: 'ready', original: 'a', modified: 'b', hideUnchangedRegions: true });
  });
});
