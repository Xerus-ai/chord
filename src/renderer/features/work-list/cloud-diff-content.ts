import type { CloudGitFileContent, CloudGitFileMeta } from '@chord/protocol';
import { CloudApiError } from '@renderer/lib/cloud-fetch';

/** What a diff pane shows: loading, a failure, a notice in place of the diff, or the two sides. */
export type DiffContent =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'notice'; title: string; description: string }
  | { kind: 'ready'; original: string; modified: string; hideUnchangedRegions: boolean };

const LEFT_THE_SNAPSHOT: DiffContent = {
  kind: 'notice',
  title: "No longer in the owner's changes",
  description:
    "This file isn't part of the latest synced snapshot. It may have been committed or reverted.",
};

/**
 * A teammate's diff of one file of the owner's pushed snapshot. Contents the
 * owner did not sync never mount Monaco: a truncated original produces a
 * garbage diff that looks authoritative. A file gone from the latest snapshot
 * (no meta, or a 404 for its contents) says so instead of showing stale text.
 */
export function cloudDiffContent(input: {
  /** Undefined when the file is not in the owner's latest snapshot. */
  meta: CloudGitFileMeta | undefined;
  pending: boolean;
  error: unknown;
  data: CloudGitFileContent | undefined;
}): DiffContent {
  const { meta, pending, error, data } = input;
  if (meta === undefined) return LEFT_THE_SNAPSHOT;
  if (meta.content_omitted) {
    return {
      kind: 'notice',
      title: 'Content not synced',
      description:
        "The owner's sync includes this file's stats only — its contents were too large, binary, or withheld by the sharing level.",
    };
  }
  if (error) {
    return error instanceof CloudApiError && error.status === 404
      ? LEFT_THE_SNAPSHOT
      : { kind: 'failed' };
  }
  if (pending || data === undefined) return { kind: 'loading' };
  return {
    kind: 'ready',
    original: data.original,
    modified: data.modified,
    hideUnchangedRegions: true,
  };
}
