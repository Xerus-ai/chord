import { z } from 'zod';

/**
 * Wire shapes for the command channel — the `commands` row and the device
 * fetch/claim/ack surface. snake_case: these are wire payloads, not app
 * models. Design: the command channel design.
 */

/** Server cap on work_item_ids per fetch — larger local sets are chunked. */
export const COMMAND_FETCH_MAX_WORK_ITEMS = 500;

export const CommandKindSchema = z.enum([
  'prompt',
  'interrupt',
  'permission_response',
  'plan_response',
]);

export const CommandStatusSchema = z.enum(['pending', 'claimed', 'acked', 'failed', 'expired']);

export const PermissionOptionIdSchema = z.enum(['allow_once', 'allow_always', 'reject_once']);

export const PlanActionSchema = z.enum(['approve', 'reject']);

export const PermissionResponseCommandPayloadSchema = z.object({
  request_id: z.string().min(1),
  option_id: PermissionOptionIdSchema,
});

export const PlanResponseCommandPayloadSchema = z.object({
  request_id: z.string().min(1),
  action: PlanActionSchema,
});

/**
 * A cloud commands row as POST/GET/fetch/claim/ack carry it. `payload` stays
 * an open record: its shape is per-kind (the schemas above) and readers
 * narrow on `kind` rather than trusting a union across the whole surface.
 */
export const CloudCommandSchema = z.object({
  id: z.string(),
  work_item_id: z.string(),
  /**
   * The agent thread this command addresses, or null for "whichever chat
   * session is live". Mirrors work_item_sessions.id (devstation-uka);
   * null remains legal for clients that predate the registry.
   */
  session_id: z.string().nullable(),
  issuer_id: z.string(),
  kind: z.string(),
  payload: z.record(z.string(), z.unknown()),
  status: CommandStatusSchema,
  status_reason: z.string().nullable(),
  claimed_by_device: z.string().nullable(),
  claimed_at: z.string().nullable(),
  acked_at: z.string().nullable(),
  expires_at: z.string().nullable(),
  created_at: z.string(),
  /**
   * Present ONLY on POST /commands/fetch rows (the device surface): the work
   * item's creator and approval policy AT FETCH TIME, so the inbox executor
   * re-validates a permission_response against the current policy instead of
   * trusting the insert-time gate alone (design §3/§6 — the owner may have
   * flipped approval_policy back to 'owner' between issue and delivery).
   * Absent on the issuer surface (POST/GET/claim/ack).
   */
  work_item_creator_id: z.string().optional(),
  work_item_approval_policy: z.string().optional(),
});

/** Body of the device-only POST /commands/fetch. */
export const CommandFetchBodySchema = z.object({
  device_id: z.string().min(1).max(128),
  work_item_ids: z.array(z.string()).max(COMMAND_FETCH_MAX_WORK_ITEMS),
});

export type CommandKind = z.infer<typeof CommandKindSchema>;
export type CommandStatus = z.infer<typeof CommandStatusSchema>;
export type PermissionResponseCommandPayload = z.infer<
  typeof PermissionResponseCommandPayloadSchema
>;
export type PlanResponseCommandPayload = z.infer<typeof PlanResponseCommandPayloadSchema>;
export type CloudCommand = z.infer<typeof CloudCommandSchema>;
export type CommandFetchBody = z.input<typeof CommandFetchBodySchema>;

/**
 * `prompt` payload as the device READS it: chat_message_id is always present
 * on a delivered command (the server fills it in when the issuer omits it),
 * which is why it is required here while the POST body's is optional.
 * `kind` is reserved for the future semantic-event taxonomy.
 */
export interface PromptCommandPayload {
  content: string;
  /** The cloud chat_messages row the server inserted alongside the command. */
  chat_message_id: string;
  kind?: string;
}
