import { z } from 'zod';

/**
 * Wire shapes for cloud git snapshots — the `work_item_git_state` +
 * `work_item_git_files` rows and the creator-only PUT body. snake_case:
 * these are wire payloads, not app models.
 */

/** Per-file cap, per side. Over → content_omitted, no content row. */
export const GIT_FILE_SIDE_BYTE_CAP = 64 * 1024;

/**
 * Total snapshot content budget: contents are included ascending by size
 * until the budget runs out; the rest become content_omitted.
 */
export const GIT_SNAPSHOT_CONTENT_BYTE_BUDGET = 800 * 1024;

export const CloudGitFileStatusSchema = z.enum(['added', 'modified', 'deleted']);

/**
 * One entry of the metadata row's `files` jsonb. content_omitted is the ONE
 * truncation flag: set when a side exceeds the per-file cap, when the
 * snapshot budget ran out, or when sharing_level is public (source never
 * ships to every signed-in user) — identical rendering for all three.
 */
export const CloudGitFileMetaSchema = z.object({
  path: z.string().min(1),
  status: CloudGitFileStatusSchema,
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  content_omitted: z.boolean(),
  /**
   * Fingerprint of (original, modified). Lets a push omit a file from
   * `contents` when its hash matches what the server already has stored,
   * instead of re-uploading identical bytes.
   *
   * Optional, NOT required-iff-not-omitted: a pre-delta-protocol client never
   * sends this field at all and always attaches full content for every
   * content_omitted=false file (see the PUT handler's reconciliation loop,
   * which falls back to that exact old behavior — always require+trust
   * content, compute a hash server-side — whenever content_hash is absent).
   * Rejecting its absence would break every such client outright.
   */
  content_hash: z.string().min(1).optional(),
});

/**
 * UTF-8 byte length. TextEncoder rather than Buffer: this package is bundled
 * into the renderer as well as run on the server, and Buffer exists only on
 * the latter.
 */
export function utf8ByteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

/** Full pre/post-images, fetched lazily one file at a time. */
export const CloudGitFileContentSchema = z.object({
  path: z.string().min(1),
  original: z.string().refine((s) => utf8ByteLength(s) <= GIT_FILE_SIDE_BYTE_CAP, {
    error: `original exceeds ${GIT_FILE_SIDE_BYTE_CAP} bytes`,
  }),
  modified: z.string().refine((s) => utf8ByteLength(s) <= GIT_FILE_SIDE_BYTE_CAP, {
    error: `modified exceeds ${GIT_FILE_SIDE_BYTE_CAP} bytes`,
  }),
});

/** A `work_item_git_state` row as the metadata GET returns it. */
export const CloudGitStateMetaSchema = z.object({
  work_item_id: z.string(),
  /** Server-incremented in-SQL on every accepted PUT. */
  version: z.number(),
  /** Owner capture time — staleness display + out-of-order rejection. */
  captured_at: z.string(),
  branch_name: z.string().nullable(),
  files: z.array(CloudGitFileMetaSchema),
  updated_at: z.string(),
});

/** Body of the creator-only PUT /work-items/:id/git-state. */
export const CloudGitStatePutBodySchema = z.object({
  /** UTC ISO with offset — naive strings land in the server's timezone. */
  captured_at: z.iso.datetime({ offset: true }),
  branch_name: z.string().nullable(),
  files: z.array(CloudGitFileMetaSchema),
  /**
   * Only files listed with content_omitted=false may appear here. Empty when
   * sharing_level is public — the server refuses public content pushes.
   */
  contents: z.array(CloudGitFileContentSchema),
});

export type CloudGitFileStatus = z.infer<typeof CloudGitFileStatusSchema>;
export type CloudGitFileMeta = z.infer<typeof CloudGitFileMetaSchema>;
export type CloudGitFileContent = z.infer<typeof CloudGitFileContentSchema>;
export type CloudGitStateMeta = z.infer<typeof CloudGitStateMetaSchema>;
export type CloudGitStatePutBody = z.input<typeof CloudGitStatePutBodySchema>;
