import { z } from 'zod';

/**
 * Wire shapes for agent permission requests — the outbound half of remote
 * approvals (`agent_permission_requests` row and the creator-only upsert the
 * owner's sync-queue drives). snake_case: these are wire payloads, not app
 * models. Design: the command channel design §4.
 */

export const PermissionRequestStatusSchema = z.enum(['pending', 'resolved', 'expired']);

export const PermissionResolutionSchema = z.enum([
  'allow_once',
  'allow_always',
  'reject_once',
  'expired',
]);

/** An option the participant card renders — the SDK's AcpPermissionOption. */
export const CloudPermissionOptionSchema = z.object({
  optionId: z.string().min(1),
  name: z.string().min(1),
  kind: z.string().min(1),
});

/** An agent_permission_requests row as GET /permission-requests carries it. */
export const CloudPermissionRequestSchema = z.object({
  request_id: z.string(),
  work_item_id: z.string(),
  /** Opaque local agent_sessions.id, or null — no cloud registry yet. */
  session_id: z.string().nullable(),
  tool_name: z.string(),
  input: z.record(z.string(), z.unknown()),
  options: z.array(CloudPermissionOptionSchema),
  status: PermissionRequestStatusSchema,
  /** null = resolved locally by the owner app, not by a cloud user. */
  resolved_by: z.string().nullable(),
  resolution: PermissionResolutionSchema.nullable(),
  created_at: z.string(),
  expires_at: z.string(),
});

/**
 * Body of the creator-only PUT upsert the sync-queue sends. The queue
 * spread-merges an update into a pending create, so a request resolved
 * before its create ever reached the cloud arrives as ONE terminal-status
 * create — tool fields present. A resolve for an already-delivered create
 * carries only work_item_id + the terminal fields.
 */
export const PermissionRequestPutBodySchema = z.object({
  work_item_id: z.string().min(1),
  session_id: z.string().nullable().optional(),
  tool_name: z.string().min(1).max(200).optional(),
  input: z.record(z.string(), z.unknown()).optional(),
  options: z.array(CloudPermissionOptionSchema).max(10).optional(),
  status: PermissionRequestStatusSchema,
  resolution: PermissionResolutionSchema.nullable().optional(),
  /** Cloud user id when a permission_response command resolved it. */
  resolved_by: z.string().nullable().optional(),
});

export type PermissionRequestStatus = z.infer<typeof PermissionRequestStatusSchema>;
export type PermissionResolution = z.infer<typeof PermissionResolutionSchema>;
export type CloudPermissionOption = z.infer<typeof CloudPermissionOptionSchema>;
export type CloudPermissionRequest = z.infer<typeof CloudPermissionRequestSchema>;
export type PermissionRequestPutBody = z.input<typeof PermissionRequestPutBodySchema>;
