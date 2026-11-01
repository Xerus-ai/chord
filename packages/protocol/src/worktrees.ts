import { z } from 'zod';

/**
 * Wire shapes for `work_item_worktrees` — worktree METADATA only (branch,
 * title, primary flag, status bucket, diff counts, archive state). No file
 * contents and no git-state rows: D2 (workspace-shell-redesign plan) keeps
 * per-worktree git state out of scope for this pass — the primary worktree
 * stays the sole source for `work_item_git_state`. This is purely what the
 * sidebar's Team sub-rows render for a shared item's teammates.
 *
 * status_bucket restates the literal vocabulary from
 * src/shared/work-item-status.ts's `WORK_ITEM_STATUS_BUCKETS` verbatim —
 * this package must not import from the desktop app (it is bundled into both
 * the Electron main process and the server), so the six buckets are copied
 * here rather than shared by reference. A worktree itself only ever produces
 * five of them today (never `done`, a work-item-level-only fact per the
 * app's `WorktreeBucket` type) but the wire shape allows the full set so the
 * two enums can't silently drift apart if that ever changes.
 */
export const CLOUD_WORKTREE_STATUS_BUCKETS = [
  'needs_input',
  'failed',
  'ready_to_review',
  'working',
  'idle',
  'done',
] as const;

export const CloudWorktreeStatusBucketSchema = z.enum(CLOUD_WORKTREE_STATUS_BUCKETS);

/** A `work_item_worktrees` row as the metadata GET/broadcast returns it. */
export const CloudWorktreeSchema = z.object({
  id: z.string(),
  work_item_id: z.string(),
  branch_name: z.string().nullable(),
  base_branch: z.string().nullable(),
  title: z.string().nullable(),
  is_primary: z.boolean(),
  status_bucket: CloudWorktreeStatusBucketSchema,
  additions: z.number().int().min(0),
  deletions: z.number().int().min(0),
  /**
   * false when the local diff stats were unavailable (the desktop's
   * `SidebarDiffStats` was null) — `additions`/`deletions` are then a
   * placeholder 0, NOT a real "no changes" answer. Consumers must gate on
   * this before trusting the counts; disguising unknown as zero would
   * misrender a worktree with real, merely-uncomputed diff state as clean.
   */
  diff_known: z.boolean(),
  /** UTC ISO with offset — naive strings land in the server's timezone. */
  archived_at: z.iso.datetime({ offset: true }).nullable(),
  updated_at: z.iso.datetime({ offset: true }),
});

/**
 * Body of the PUT /work-items/:id/worktrees bulk replace. `work_item_id` and
 * `updated_at` are route/server-assigned, never client-supplied.
 */
export const CloudWorktreePutEntrySchema = CloudWorktreeSchema.omit({
  work_item_id: true,
  updated_at: true,
});

export const CloudWorktreesPutBodySchema = z.object({
  worktrees: z.array(CloudWorktreePutEntrySchema),
});

export type CloudWorktreeStatusBucket = z.infer<typeof CloudWorktreeStatusBucketSchema>;
export type CloudWorktree = z.infer<typeof CloudWorktreeSchema>;
export type CloudWorktreePutEntry = z.infer<typeof CloudWorktreePutEntrySchema>;
export type CloudWorktreesPutBody = z.input<typeof CloudWorktreesPutBodySchema>;
