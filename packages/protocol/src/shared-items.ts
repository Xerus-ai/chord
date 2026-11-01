import { z } from 'zod';

/**
 * Who a work item belongs to, joined from users, so a teammate's app can
 * name the owner and show their avatar without fetching a roster.
 */
export const WorkItemOwnerSchema = z.object({
  creator_id: z.string(),
  creator_name: z.string().nullable(),
  creator_email: z.string(),
  creator_avatar_url: z.string().nullable(),
});

export type WorkItemOwner = z.infer<typeof WorkItemOwnerSchema>;

/**
 * How the caller reaches a work item: the work item itself (a member, team
 * access, or the author), or only some of its artifacts, shared alone.
 */
export const WorkItemAccessScopeSchema = z.enum(['work_item', 'artifacts']);

export type WorkItemAccessScope = z.infer<typeof WorkItemAccessScopeSchema>;

/**
 * A work item someone reaches only through artifacts shared with them alone
 * (shared-items design §5): its header and the ids of those artifacts. Its
 * chat, git state and sessions answer 403 `ARTIFACTS_ONLY`. Served to clients
 * that ask with `?include=artifacts`.
 */
export const ArtifactsOnlyWorkItemSchema = WorkItemOwnerSchema.extend({
  access_scope: z.literal('artifacts'),
  id: z.string(),
  org_id: z.string(),
  name: z.string(),
  status: z.string(),
  repo_name: z.string().nullable(),
  /** The repo's normalized origin, matched against the caller's own repos. */
  repo_remote_url: z.string().nullable(),
  updated_at: z.string(),
  version_number: z.number(),
  /** The artifacts shared with the caller, by team membership or a member row. */
  shared_artifacts: z.array(z.object({ id: z.string(), name: z.string() })).min(1),
});

export type ArtifactsOnlyWorkItem = z.infer<typeof ArtifactsOnlyWorkItemSchema>;

/** The refusal an artifact-only caller gets where the work item itself begins. */
export const ARTIFACTS_ONLY_CODE = 'ARTIFACTS_ONLY';

/**
 * A public link resolved for a signed-in caller who reaches its artifact
 * (GET /public-links/:token/resolve): the desktop opens it as a tab of its
 * work item. Anyone else gets a 404, the same as for a bad token.
 */
export const PublicLinkResolutionSchema = z.object({
  artifact_id: z.string(),
  work_item_id: z.string(),
});

export type PublicLinkResolution = z.infer<typeof PublicLinkResolutionSchema>;

/** The most comments one import request carries; the desktop sends larger sets in batches. */
export const ARTIFACT_COMMENT_IMPORT_BATCH = 200;

/**
 * A comment written on the author's device before its artifact first reached
 * the cloud (devstation-85y). Its id is kept, so a reply keeps its parent and
 * a retried import adds nothing.
 */
export const ImportedArtifactCommentSchema = z.object({
  id: z.string().min(1),
  parent_comment_id: z.string().nullable(),
  anchor_key: z.string().nullable(),
  anchor_text: z.string().nullable(),
  body: z.string().min(1),
  resolved: z.boolean(),
  created_at: z.iso.datetime(),
});

export type ImportedArtifactComment = z.infer<typeof ImportedArtifactCommentSchema>;

/** POST /work-items/:id/artifacts/:artifact_id/comments/import */
export const ArtifactCommentImportSchema = z.object({
  comments: z.array(ImportedArtifactCommentSchema).min(1).max(ARTIFACT_COMMENT_IMPORT_BATCH),
});

export type ArtifactCommentImport = z.infer<typeof ArtifactCommentImportSchema>;

/** How many of the sent comments were new to the cloud. */
export interface ArtifactCommentImportResult {
  imported: number;
}
