import { randomUUID } from 'node:crypto';
import {
  CommandStatusSchema,
  PermissionResponseCommandPayloadSchema,
  PlanResponseCommandPayloadSchema,
  type ChatMessageReceivedServerEvent,
  type CommandsAvailableServerEvent,
} from '@chord/protocol';
import { and, asc, eq } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireWorkItemRole } from '../access/access-middleware.js';
import { db } from '../db/client.js';
import {
  agentPermissionRequests,
  agentPlanRequests,
  chatMessages,
  commands,
  workItems,
} from '../db/schema.js';
import { uuidv7 } from '../lib/uuidv7.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

// An interrupt for a turn that ended long ago is wrong to deliver — it dies
// server-side instead of parking. 'prompt' never expires (parks locally);
// 'permission_response' inherits its permission request's expires_at.
const INTERRUPT_EXPIRY_MS = 10 * 60 * 1000;

interface WorkItemParams {
  work_item_id: string;
}

// Delivered prompt content is ultimately written to a PTY on the owner's
// device — it is text, not keystrokes. Strip control characters (keeping
// newline and tab) so escape sequences and carriage returns can never drive
// the terminal. The device strips again before pty.write; this keeps the
// stored chat row clean too.
export function stripControlCharacters(value: string): string {
  // \u0009 (tab) and \u000A (newline) are the only C0 codes left out of the
  // class; everything else in 0..31 is stripped, \u000D (CR) included. CR is
  // the device's submit keystroke (keystroke-injection.ts writes `\r`), so
  // leaving it in would let one authorized prompt submit several turns.
  return value.replace(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F]/g, '');
}

// Per-kind payloads (design §1). `kind` inside the prompt payload is
// reserved metadata for the future semantic-event taxonomy
// (question/handoff/blocker) — accepted and stored, unused in v1.
const PromptPayloadSchema = z.object({
  content: z
    .string()
    .max(100_000)
    .transform(stripControlCharacters)
    .pipe(z.string().min(1).max(100_000)),
  // Client-supplied so the issuer can optimistically render its own chat
  // row; server-generated when absent. Stored back into the command payload
  // so the device can tie prompt delivery to the ingested chat message.
  chat_message_id: z.uuid().optional(),
  kind: z.string().max(64).optional(),
});

const PermissionResponsePayloadSchema = PermissionResponseCommandPayloadSchema;

const PlanResponsePayloadSchema = PlanResponseCommandPayloadSchema;

// session_id is the agent thread being addressed — it mirrors
// work_item_sessions.id since devstation-uka (before that it was opaque:
// see schema.ts); optional on every kind. Still only shape-checked here: the
// owner's device is what validates the target, via validateTargetSession in
// command-inbox-service.ts (70a67b8), which knows the live session state this
// route does not. Unlike the WS chat path, which rejects an unknown session
// outright, a command for a merely-suspended thread must PARK rather than
// fail — that judgement belongs on the device.
export const CreateCommandSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('prompt'),
    session_id: z.string().nullable().optional(),
    payload: PromptPayloadSchema,
  }),
  z.object({
    kind: z.literal('interrupt'),
    session_id: z.string().nullable().optional(),
    payload: z.strictObject({}).default({}),
  }),
  z.object({
    kind: z.literal('permission_response'),
    session_id: z.string().nullable().optional(),
    payload: PermissionResponsePayloadSchema,
  }),
  z.object({
    kind: z.literal('plan_response'),
    session_id: z.string().nullable().optional(),
    payload: PlanResponsePayloadSchema,
  }),
]);

const ListCommandsQuerySchema = z.object({
  status: CommandStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

/**
 * The issuer half of the command channel: participants (write tier) insert
 * commands for the owner's device to execute; anyone with access reads
 * command states for status chips. The device half (fetch/claim/ack) is
 * routes/commands-device.ts.
 */
export function createWorkItemCommandsRouter(connectionManager: ConnectionManager): Router {
  const commandsRouter = Router({ mergeParams: true });
  commandsRouter.use(requireWorkItemRole('view'));

  commandsRouter.post(
    '/',
    requireWorkItemRole('edit'),
    async (req: Request<WorkItemParams>, res) => {
      const { user } = req as unknown as AuthenticatedRequest;
      const { work_item_id } = req.params;
      const parsed = CreateCommandSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }
      const cmd = parsed.data;

      // creator_id targets the doorbell; approval_policy gates
      // permission_response. Read fresh from the row, never the 20s access
      // cache — approval_policy is a security gate and must not be stale.
      const [item] = await db
        .select({ creator_id: workItems.creator_id, approval_policy: workItems.approval_policy })
        .from(workItems)
        .where(eq(workItems.id, work_item_id))
        .limit(1);
      if (!item) {
        res.status(404).json({ error: 'Work item not found' });
        return;
      }

      // Owner always may drive their agent; participants only under the
      // per-item opt-in. This sits ON TOP of the write tier the middleware
      // checked, and covers EVERY kind — a prompt or interrupt drives the
      // owner's agent exactly as much as an approval response does.
      if (item.creator_id !== user.userId && item.approval_policy !== 'participants') {
        res.status(403).json({ error: 'Approval policy restricts commands to the owner' });
        return;
      }

      const id = uuidv7();
      let expires_at: Date | null = null;
      let payload: Record<string, unknown> = cmd.payload;

      if (cmd.kind === 'interrupt') {
        expires_at = new Date(Date.now() + INTERRUPT_EXPIRY_MS);
      }

      if (cmd.kind === 'permission_response') {
        const [request] = await db
          .select()
          .from(agentPermissionRequests)
          .where(
            and(
              eq(agentPermissionRequests.request_id, cmd.payload.request_id),
              eq(agentPermissionRequests.work_item_id, work_item_id)
            )
          )
          .limit(1);
        if (!request) {
          res.status(404).json({ error: 'Permission request not found' });
          return;
        }
        // The sweep may lag past-due rows — treat them as expired here too.
        if (request.status !== 'pending' || request.expires_at <= new Date()) {
          res.status(409).json({ error: 'Approval no longer pending', status: request.status });
          return;
        }
        expires_at = request.expires_at;
      }

      if (cmd.kind === 'plan_response') {
        const [planRequest] = await db
          .select()
          .from(agentPlanRequests)
          .where(
            and(
              eq(agentPlanRequests.request_id, cmd.payload.request_id),
              eq(agentPlanRequests.work_item_id, work_item_id)
            )
          )
          .limit(1);
        if (!planRequest) {
          res.status(404).json({ error: 'Plan request not found' });
          return;
        }
        if (planRequest.status !== 'pending' || planRequest.expires_at <= new Date()) {
          res
            .status(409)
            .json({ error: 'Plan approval no longer pending', status: planRequest.status });
          return;
        }
        expires_at = planRequest.expires_at;
      }

      let created: typeof commands.$inferSelect;

      if (cmd.kind === 'prompt') {
        const chatMessageId = cmd.payload.chat_message_id ?? randomUUID();
        payload = { ...cmd.payload, chat_message_id: chatMessageId };

        // A client-supplied chat id that already exists means a replayed or
        // buggy POST — reject before the batch instead of failing it midway.
        // (The insert below stays plain, so a race on this check fails the
        // whole atomic batch loudly rather than half-applying.)
        if (cmd.payload.chat_message_id) {
          const [existing] = await db
            .select({ id: chatMessages.id })
            .from(chatMessages)
            .where(eq(chatMessages.id, chatMessageId))
            .limit(1);
          if (existing) {
            res.status(409).json({ error: 'chat_message_id already exists' });
            return;
          }
        }

        // ONE batch (a non-interactive transaction on neon-http): the
        // teammate's prompt is room-visible chat the instant the command
        // exists — never one without the other. metadata marks the row as an
        // agent prompt and ties it back to the command for status chips.
        const [cmdRows, chatRows] = await db.batch([
          db
            .insert(commands)
            .values({
              id,
              work_item_id,
              session_id: cmd.session_id ?? null,
              issuer_id: user.userId,
              kind: cmd.kind,
              payload,
              expires_at,
            })
            .returning(),
          db
            .insert(chatMessages)
            .values({
              id: chatMessageId,
              work_item_id,
              session_id: cmd.session_id ?? null,
              sender_id: user.userId,
              sender_type: 'human',
              sender_name: user.email,
              content: cmd.payload.content,
              message_type: 'text',
              metadata: { agent_prompt: true, command_id: id },
            })
            .returning(),
        ]);
        const cmdRow = cmdRows[0];
        const chatRow = chatRows[0];
        // insert().returning() always yields the row — this guard only
        // narrows the tuple types; hitting it would be a driver bug.
        if (!cmdRow || !chatRow) {
          throw new Error('command batch insert returned no rows');
        }
        created = cmdRow;

        // Issuer and room see the prompt instantly, independent of delivery.
        const chatEvent: ChatMessageReceivedServerEvent = {
          type: 'chat_message_received',
          payload: {
            id: chatRow.id,
            work_item_id,
            session_id: chatRow.session_id,
            sender_id: chatRow.sender_id,
            sender_type: 'human',
            sender_name: chatRow.sender_name,
            content: chatRow.content,
            message_type: chatRow.message_type,
            metadata: chatRow.metadata as Record<string, unknown>,
            created_at: chatRow.created_at.toISOString(),
          },
        };
        connectionManager.broadcastToRoom(workItemRoomId(work_item_id), chatEvent);
      } else {
        const [row] = await db
          .insert(commands)
          .values({
            id,
            work_item_id,
            session_id: cmd.session_id ?? null,
            issuer_id: user.userId,
            kind: cmd.kind,
            payload,
            expires_at,
          })
          .returning();
        if (!row) {
          throw new Error('command insert returned no row');
        }
        created = row;
      }

      // The doorbell: a thin ping to the creator's device sockets — the
      // device fetches over REST. Missed pings don't matter (reconnect +
      // 30s interval fetch), so this is fire-and-forget after the insert.
      const doorbell: CommandsAvailableServerEvent = {
        type: 'commands_available',
        payload: { work_item_id },
      };
      connectionManager.broadcastToUserDevices(item.creator_id, doorbell);

      res.status(201).json(created);
    }
  );

  // Issuer/room view of command states — drives the status chips. Any
  // access level may read; ascending id is issue order.
  commandsRouter.get('/', async (req: Request<WorkItemParams>, res) => {
    const { work_item_id } = req.params;
    const parsed = ListCommandsQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const scope = parsed.data.status
      ? and(eq(commands.work_item_id, work_item_id), eq(commands.status, parsed.data.status))
      : eq(commands.work_item_id, work_item_id);

    const rows = await db
      .select()
      .from(commands)
      .where(scope)
      .orderBy(asc(commands.id))
      .limit(parsed.data.limit);

    res.json(rows);
  });

  return commandsRouter;
}
