import { z } from 'zod';

/**
 * Wire shapes for `work_item_sessions` — the cloud REGISTRY of a shared work
 * item's agent chat threads. It exists so a participant's client can answer
 * "which threads are there, and what is each one called", which is the whole
 * premise of the post-Room model: the thread you are looking at IS the agent
 * you are talking to (see plans/2026-09-15-feat-remove-room-shared-session-chats).
 * Before this, `agent_sessions` never left the owner's SQLite and a teammate
 * saw one merged feed with ordinal-numbered dividers.
 *
 * Only `kind = 'chat'` sessions are published. A shell terminal is not a
 * shared conversation — there is no `kind` field here because a filtered set
 * makes it dead weight on the wire.
 *
 * Deliberately ABSENT from this shape, though present locally
 * (src/main/db/schema-work-items.ts): `cwd` (an absolute path on the owner's
 * disk — a filesystem-layout leak to everyone the item is shared with),
 * `external_session_id` (a provider-side resume handle, credential-shaped and
 * of no use to a reader), and `provision_status` / `respawn_count` /
 * `last_turn_status` (owner process-lifecycle internals; `status` is the
 * participant-facing signal). Adding a field here publishes it to every
 * participant — that is the question to ask before extending this file.
 */

/**
 * Session lifecycle, restating `agent_sessions.status` verbatim. This package
 * is bundled into both the Electron main process and the server and must not
 * import from the desktop app, so the vocabulary is copied rather than shared
 * by reference — the same rule worktrees.ts follows for its status buckets.
 *
 * `done` is included even though the owner's tab policy drops a done session's
 * tab (center-tabs-model.ts): the registry reports what exists and each client
 * applies its own tab policy. A done row that vanished from the wire would be
 * indistinguishable from one that was never published.
 */
export const CLOUD_SESSION_STATUSES = ['active', 'suspended', 'done'] as const;

export const CloudSessionStatusSchema = z.enum(CLOUD_SESSION_STATUSES);

/** A `work_item_sessions` row as the registry GET/broadcast returns it. */
export const CloudSessionSchema = z.object({
  id: z.string(),
  work_item_id: z.string(),
  /** 'claude' | 'codex' | … — null for a session whose provider is unknown. */
  agent_provider_id: z.string().nullable(),
  title: z.string().nullable(),
  status: CloudSessionStatusSchema,
  /**
   * The worktree this thread runs in, or null. Plain text, NOT a foreign key
   * to `work_item_worktrees`: that table is maintained by its own whole-set
   * replace, which trims rows the owner has dropped locally, and a trim must
   * not cascade a live conversation out of existence. Consumers resolve it
   * best-effort for a branch label and fall back to the title.
   */
  worktree_id: z.string().nullable(),
  /** UTC ISO with offset — naive strings land in the server's timezone. */
  last_active_at: z.iso.datetime({ offset: true }),
  updated_at: z.iso.datetime({ offset: true }),
  /**
   * The model and permission mode as the owner's composer names them
   * ("Opus 4.5", "Ask before edits"), resolved from the agent's catalog on
   * the owner's machine; a teammate's composer shows them, disabled (user
   * decision 2026-10-01). Null when the owner's app could not name them.
   */
  model_label: z.string().nullable(),
  permission_mode_label: z.string().nullable(),
});

/**
 * Body of the PUT /work-items/:id/sessions bulk replace. `work_item_id` and
 * `updated_at` are route/server-assigned, never client-supplied.
 */
export const CloudSessionPutEntrySchema = CloudSessionSchema.omit({
  work_item_id: true,
  updated_at: true,
}).extend({
  // Optional on the wire: an owner app from before the labels sends none.
  model_label: z.string().nullable().optional(),
  permission_mode_label: z.string().nullable().optional(),
});

export const CloudSessionsPutBodySchema = z.object({
  sessions: z.array(CloudSessionPutEntrySchema),
});

export type CloudSessionStatus = z.infer<typeof CloudSessionStatusSchema>;
export type CloudSession = z.infer<typeof CloudSessionSchema>;
export type CloudSessionPutEntry = z.infer<typeof CloudSessionPutEntrySchema>;
export type CloudSessionsPutBody = z.input<typeof CloudSessionsPutBodySchema>;
