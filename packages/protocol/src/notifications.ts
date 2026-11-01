import { z } from 'zod';

/**
 * The kinds of notification (shared-items step 2). A row stores facts — who
 * acted, on what, an excerpt — and the app builds the sentence from them;
 * checked in code, not by a DB enum.
 */
export const NotificationTypeSchema = z.enum([
  'shared_with_you',
  'mentioned',
  'new_message',
  'artifact_comment',
  'team_invite',
]);

export type NotificationType = z.infer<typeof NotificationTypeSchema>;

/**
 * A notification as the app reads it: the stored facts plus the names they
 * point at, joined in one query (GET /notifications) and sent the same way
 * live (`notification_received`). An id is null once what it named was
 * deleted, and its name with it.
 */
export const NotificationViewSchema = z.object({
  id: z.string(),
  type: NotificationTypeSchema,
  actor_user_id: z.string().nullable(),
  actor_name: z.string().nullable(),
  actor_email: z.string().nullable(),
  actor_avatar_url: z.string().nullable(),
  /** The team a team_invite is for. */
  org_id: z.string().nullable(),
  org_name: z.string().nullable(),
  work_item_id: z.string().nullable(),
  work_item_name: z.string().nullable(),
  work_item_repo_name: z.string().nullable(),
  artifact_id: z.string().nullable(),
  artifact_name: z.string().nullable(),
  comment_id: z.string().nullable(),
  message_id: z.string().nullable(),
  /** The role of a share (`view` | `edit`), or the start of a message or comment. */
  excerpt: z.string().nullable(),
  read: z.boolean(),
  created_at: z.string(),
  /**
   * Live frames of a team_invite only, so the inline Accept/Decline can target
   * the invite; never stored. Open invites are listed by
   * GET /organizations/invites/mine.
   */
  invite_id: z.string().optional(),
});

export type NotificationView = z.infer<typeof NotificationViewSchema>;
