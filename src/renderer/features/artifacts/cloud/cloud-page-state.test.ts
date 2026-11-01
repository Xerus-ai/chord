import { describe, expect, it } from 'vitest';
import {
  describeCloudPageResult,
  formatCloudVersionLabel,
  NO_VIEW_MESSAGE,
  planVersionEventRefresh,
} from './cloud-page-state';

const MINUTE = 60_000;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * MINUTE).toISOString();
}

describe('formatCloudVersionLabel — the header over a cloud page', () => {
  it('names the version, when it was saved and by whom', () => {
    expect(
      formatCloudVersionLabel({ versionNumber: 4, createdAt: minutesAgo(5), authorName: 'Ana' })
    ).toBe('Version 4 · saved 5m ago by Ana');
  });

  it('omits the author when the server has none on record', () => {
    expect(
      formatCloudVersionLabel({ versionNumber: 1, createdAt: minutesAgo(0), authorName: null })
    ).toBe('Version 1 · saved just now');
  });
});

describe('describeCloudPageResult — prepareCloud outcome to what the tab shows', () => {
  const READY = {
    success: true as const,
    data: {
      url: 'chord-artifact://snapshot-abc/index.html',
      versionId: 'v2',
      versionNumber: 2,
      trigger: 'manual',
      authorName: 'Ana',
      createdAt: minutesAgo(3),
    },
  };

  it('a prepared view mounts the frame under its version header', () => {
    expect(describeCloudPageResult(READY)).toEqual({
      kind: 'ready',
      url: 'chord-artifact://snapshot-abc/index.html',
      versionId: 'v2',
      label: 'Version 2 · saved 3m ago by Ana',
    });
  });

  it('no_view is the empty state, not an error', () => {
    expect(
      describeCloudPageResult({
        success: false,
        error: { type: 'no_view', message: 'no view uploaded' },
      })
    ).toEqual({ kind: 'no-view', message: NO_VIEW_MESSAGE });
    expect(NO_VIEW_MESSAGE).toBe("The author hasn't published a viewable version yet");
  });

  it('any other failure is shown with its reason', () => {
    expect(
      describeCloudPageResult({
        success: false,
        error: { type: 'fetch_failed', message: 'Cloud API 500: boom' },
      })
    ).toEqual({ kind: 'error', message: 'Cloud API 500: boom' });
  });

  it('a failure without a message is shown by its type', () => {
    expect(describeCloudPageResult({ success: false, error: { type: 'forbidden' } })).toEqual({
      kind: 'error',
      message: 'forbidden',
    });
  });
});

describe('planVersionEventRefresh — artifact_version_created for an open cloud tab', () => {
  const base = {
    work_item_id: 'wi1',
    artifact_id: 'art1',
    version_id: 'v5',
    version_number: 5,
    trigger: 'manual' as const,
    has_view: true,
  };

  it('a new page version with a view reloads the frame and the history', () => {
    expect(planVersionEventRefresh(base, { artifactId: 'art1', renderClass: 'page' })).toEqual({
      refetchVersions: true,
      reloadFrame: true,
    });
  });

  it('a page version without a view refreshes the history only', () => {
    expect(
      planVersionEventRefresh(
        { ...base, has_view: false },
        { artifactId: 'art1', renderClass: 'page' }
      )
    ).toEqual({ refetchVersions: true, reloadFrame: false });
  });

  it('a document version refreshes the history; the live doc needs no reload', () => {
    expect(
      planVersionEventRefresh(
        { ...base, has_view: false },
        { artifactId: 'art1', renderClass: 'document' }
      )
    ).toEqual({ refetchVersions: true, reloadFrame: false });
  });

  it('another artifact’s version changes nothing here', () => {
    expect(planVersionEventRefresh(base, { artifactId: 'other', renderClass: 'page' })).toEqual({
      refetchVersions: false,
      reloadFrame: false,
    });
  });
});
