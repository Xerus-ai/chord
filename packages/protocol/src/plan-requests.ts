import { z } from 'zod';

/**
 * Wire shapes for agent plan requests — the outbound half of remote plan
 * approvals (`agent_plan_requests` row and the creator-only upsert the
 * owner's sync-queue drives). snake_case: these are wire payloads, not app
 * models. Design: the command channel design §4.
 */

export const PlanRequestStatusSchema = z.enum(['pending', 'resolved', 'expired']);

export const PlanResolutionSchema = z.enum(['approve', 'reject', 'expired']);

export const PlanStepSchema = z.object({
  text: z.string(),
  completed: z.boolean(),
});

/** An agent_plan_requests row as GET /plan-requests carries it. */
export const CloudPlanRequestSchema = z.object({
  request_id: z.string(),
  work_item_id: z.string(),
  /** Opaque local agent_sessions.id, or null — no cloud registry yet. */
  session_id: z.string().nullable(),
  title: z.string(),
  overview: z.string(),
  steps: z.array(PlanStepSchema),
  status: PlanRequestStatusSchema,
  /** null = resolved locally by the owner app, not by a cloud user. */
  resolved_by: z.string().nullable(),
  resolution: PlanResolutionSchema.nullable(),
  created_at: z.string(),
  expires_at: z.string(),
});

/**
 * Body of the creator-only PUT upsert the sync-queue sends. The queue
 * spread-merges an update into a pending create, so a request resolved
 * before its create ever reached the cloud arrives as ONE terminal-status
 * create — plan fields present. A resolve for an already-delivered create
 * carries only work_item_id + the terminal fields.
 */
export const PlanRequestPutBodySchema = z.object({
  work_item_id: z.string().min(1),
  session_id: z.string().nullable().optional(),
  title: z.string().min(1).max(500).optional(),
  overview: z.string().optional(),
  steps: z.array(PlanStepSchema).optional(),
  status: PlanRequestStatusSchema,
  resolution: PlanResolutionSchema.nullable().optional(),
  /** Cloud user id when a plan_response command resolved it. */
  resolved_by: z.string().nullable().optional(),
});

export type PlanRequestStatus = z.infer<typeof PlanRequestStatusSchema>;
export type PlanResolution = z.infer<typeof PlanResolutionSchema>;
export type PlanStep = z.infer<typeof PlanStepSchema>;
export type CloudPlanRequest = z.infer<typeof CloudPlanRequestSchema>;
export type PlanRequestPutBody = z.input<typeof PlanRequestPutBodySchema>;
