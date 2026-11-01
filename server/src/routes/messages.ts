import {
  CloudChatBulkMessageSchema,
  CreateChatMessageBodySchema,
  HydrateChatMessagesBodySchema,
  type ChatMessageReceivedServerEvent,
  type ChatMessagesBulkReceivedServerEvent,
} from '@chord/protocol';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { requireWorkItemRole } from '../access/access-middleware.js';
import { deliverHumanMessage, insertHumanMessage } from '../chat-messages/post-human-message.js';
import { db } from '../db/client.js';
import { chatMessages } from '../db/schema.js';
import type { AuthenticatedRequest } from '../middleware/auth.js';
import { workItemRoomId } from '../ws/authorize.js';
import type { ConnectionManager } from '../ws/connection-manager.js';

// Below this many newly-inserted rows, broadcast the old way — one
// chat_message_received frame per row. That keeps a not-yet-upgraded client
// fully correct for the common case (a handful of live agent turns), while
// only owner backfills large enough to actually matter (up to 500 rows per
// PUT) take the new batched-frame path. Raise only once every consumer of
// chat_messages_bulk_received is confirmed live.
const INDIVIDUAL_BROADCAST_MAX = 10;

interface WorkItemParams {
  work_item_id: string;
}

interface MessageParams extends WorkItemParams {
  message_id: string;
}

// session_id is the local agent_sessions.id that produced this message, or
// absent for a plain participant post. See the session_id comment on
// chatMessages in db/schema.ts — not validated against a cloud row, no FK
// exists yet.
const CreateMessageSchema = CreateChatMessageBodySchema;

const ListMessagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  // Keyset cursors: "<created_at ISO>,<id>". The id tiebreaker is mandatory —
  // agent bursts share timestamps and offset pagination would skip or repeat.
  before: z.string().optional(),
  after: z.string().optional(),
});

// Bounds POST /hydrate to a reasonable single-request cost — callers chunk
// larger id lists client-side (see use-cloud-chat.ts hydrateMessages).
const HydrateMessagesSchema = HydrateChatMessagesBodySchema;

// Owner history backfill rows, plus the server-only per-row size backstop.
// `content` has NO minimum — agent turns carry empty content by design
// (everything lives in metadata.items); a min(1) would 400 every backfill
// containing one.
const PER_MESSAGE_SIZE_CAP = 300_000;
const BulkMessageSchema = CloudChatBulkMessageSchema.refine(
  (m) => JSON.stringify(m).length <= PER_MESSAGE_SIZE_CAP,
  { error: `message exceeds ${PER_MESSAGE_SIZE_CAP} byte cap` }
);

const BulkPutSchema = z.object({
  messages: z.array(BulkMessageSchema).min(1).max(500),
});

interface Cursor {
  ts: Date;
  id: string;
}

function parseCursor(raw: string): Cursor | null {
  const separator = raw.indexOf(',');
  if (separator < 0) return null;
  const ts = new Date(raw.slice(0, separator));
  if (Number.isNaN(ts.getTime())) return null;
  return { ts, id: raw.slice(separator + 1) };
}

// agent_turn rows carry their whole transcript (tool calls, diffs, output) in
// metadata and are pre-capped at 256KB each on the owner's push (see
// chat-wire-mapper.ts). A list page of up to 500 of those is a multi-MB
// response on every seed/reconnect fetch. Rows over this cap ship a marker
// instead of their metadata; GET /:message_id fetches the full row on demand
// once a consumer actually needs to render it.
const METADATA_LIST_BYTE_CAP = 4_000;

function trimForList<T extends { metadata: unknown }>(row: T): T {
  const metadata = row.metadata as { turnId?: string; items?: unknown[] } | null;
  if (JSON.stringify(metadata ?? {}).length <= METADATA_LIST_BYTE_CAP) return row;
  return {
    ...row,
    metadata: {
      truncated: true,
      turnId: metadata?.turnId,
      item_count: Array.isArray(metadata?.items) ? metadata.items.length : undefined,
    },
  };
}

export function createMessagesRouter(connectionManager: ConnectionManager): Router {
  const messagesRouter = Router({ mergeParams: true });
  messagesRouter.use(requireWorkItemRole('view'));

  messagesRouter.get('/', async (req: Request<WorkItemParams>, res) => {
    const { work_item_id } = req.params;
    const parsed = ListMessagesQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }
    const { limit, before, after } = parsed.data;
    if (before && after) {
      res.status(400).json({ error: 'before and after are mutually exclusive' });
      return;
    }

    const scope = eq(chatMessages.work_item_id, work_item_id);

    if (after) {
      const cursor = parseCursor(after);
      if (!cursor) {
        res.status(400).json({ error: 'malformed after cursor' });
        return;
      }
      // Cursors round-trip through JS Dates (millisecond precision) while
      // Postgres stores microseconds — compare on ms-truncated timestamps or
      // the boundary row leaks back into every page.
      const rows = await db
        .select()
        .from(chatMessages)
        .where(
          sql`${scope} AND (date_trunc('milliseconds', ${chatMessages.created_at}), ${chatMessages.id}) > (${cursor.ts}, ${cursor.id})`
        )
        .orderBy(asc(chatMessages.created_at), asc(chatMessages.id))
        .limit(limit);
      res.json(rows.map(trimForList));
      return;
    }

    if (before) {
      const cursor = parseCursor(before);
      if (!cursor) {
        res.status(400).json({ error: 'malformed before cursor' });
        return;
      }
      const rows = await db
        .select()
        .from(chatMessages)
        .where(
          sql`${scope} AND (date_trunc('milliseconds', ${chatMessages.created_at}), ${chatMessages.id}) < (${cursor.ts}, ${cursor.id})`
        )
        .orderBy(desc(chatMessages.created_at), desc(chatMessages.id))
        .limit(limit);
      res.json(rows.reverse().map(trimForList));
      return;
    }

    // No cursor: the newest page, in ascending order like every other page.
    const rows = await db
      .select()
      .from(chatMessages)
      .where(scope)
      .orderBy(desc(chatMessages.created_at), desc(chatMessages.id))
      .limit(limit);
    res.json(rows.reverse().map(trimForList));
  });

  // On-demand full fetch for a row the list endpoint trimmed (see
  // trimForList above) — scoped to the path work_item_id so a message id
  // from another tenant's work item can't be pulled through an authorized
  // room (same chain-check requirement as the artifact/comment routes).
  messagesRouter.get('/:message_id', async (req: Request<MessageParams>, res) => {
    const { work_item_id, message_id } = req.params;

    const [message] = await db
      .select()
      .from(chatMessages)
      .where(and(eq(chatMessages.id, message_id), eq(chatMessages.work_item_id, work_item_id)))
      .limit(1);

    if (!message) {
      res.status(404).json({ error: 'Message not found' });
      return;
    }

    res.json(message);
  });

  // Batch counterpart to GET /:message_id: a seed page can trim many
  // agent_turn rows at once, and hydrating them one request each is its own
  // N+1. Same chain-check scoping as the single-row route, but as one query
  // over an id list; ids that don't exist or belong to a different work
  // item are silently absent from the result — a partial miss on a batch
  // lookup isn't an error the way a missing single resource is.
  messagesRouter.post('/hydrate', async (req: Request<WorkItemParams>, res) => {
    const { work_item_id } = req.params;
    const parsed = HydrateMessagesSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues });
      return;
    }

    const messages = await db
      .select()
      .from(chatMessages)
      .where(
        and(inArray(chatMessages.id, parsed.data.ids), eq(chatMessages.work_item_id, work_item_id))
      );

    res.json(messages);
  });

  messagesRouter.post(
    '/',
    requireWorkItemRole('edit'),
    async (req: Request<WorkItemParams>, res) => {
      const { user } = req as unknown as AuthenticatedRequest;
      const { work_item_id } = req.params;
      const parsed = CreateMessageSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      const result = await insertHumanMessage(user, { ...parsed.data, work_item_id });
      if (result.kind === 'unknown_session') {
        res.status(400).json({ error: 'unknown session for work item' });
        return;
      }
      if (result.kind === 'id_conflict') {
        res.status(409).json({ error: 'message id conflict' });
        return;
      }
      if (result.kind === 'replayed') {
        res.status(200).json(result.message);
        return;
      }
      await deliverHumanMessage(connectionManager, result.message);
      res.status(201).json(result.message);
    }
  );

  /**
   * Owner history push: idempotent bulk upsert of the owner's local chat
   * history, and the only live delivery channel for agent output (the WS
   * handler hardcodes sender_type human). Creator-only — this endpoint writes
   * arbitrary sender names/types and timestamps, which a participant must
   * never be able to forge. The insert is ONE multi-row statement (atomic on
   * neon-http). The broadcast is batched too, above INDIVIDUAL_BROADCAST_MAX
   * rows (see constant) — a single chat_messages_bulk_received frame per room
   * member instead of one chat_message_received frame per message (an owner
   * backfill can carry up to 500 rows — that was 500 JSON.stringify + 500
   * ws.send calls per room member). An idempotent replay broadcasts nothing,
   * and no offline-notification fan-out happens.
   */
  messagesRouter.put(
    '/bulk',
    requireWorkItemRole('author'),
    async (req: Request<WorkItemParams>, res) => {
      const { user } = req as unknown as AuthenticatedRequest;
      const { work_item_id } = req.params;
      const parsed = BulkPutSchema.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues });
        return;
      }

      // Server stamps identity: sender_id is never accepted from the payload.
      const rows = parsed.data.messages.map((m) => ({
        id: m.id,
        work_item_id,
        session_id: m.session_id ?? null,
        sender_id: m.sender_type === 'human' ? user.userId : null,
        sender_type: m.sender_type,
        sender_name: m.sender_name ?? null,
        content: m.content,
        message_type: m.message_type,
        metadata: m.metadata,
        created_at: new Date(m.created_at),
      }));

      const inserted = await db.insert(chatMessages).values(rows).onConflictDoNothing().returning();

      const insertedIds = new Set(inserted.map((r) => r.id));
      const conflictIds = rows.map((r) => r.id).filter((id) => !insertedIds.has(id));
      if (conflictIds.length > 0) {
        // Conflicting ids must already exist in THIS work item (that's a retry
        // → success). An owner's UUIDs colliding across items is a bug or an
        // attack — fail loud with the offending ids.
        const existing = await db
          .select({ id: chatMessages.id, work_item_id: chatMessages.work_item_id })
          .from(chatMessages)
          .where(inArray(chatMessages.id, conflictIds));
        const foreign = existing.filter((e) => e.work_item_id !== work_item_id).map((e) => e.id);
        if (foreign.length > 0) {
          res
            .status(409)
            .json({ error: 'message ids conflict outside this work item', ids: foreign });
          return;
        }
      }

      if (inserted.length > 0) {
        const roomId = workItemRoomId(work_item_id);
        const byId = new Map(parsed.data.messages.map((m) => [m.id, m]));
        const payloads = inserted.map((row) => {
          const source = byId.get(row.id)!;
          return {
            id: row.id,
            work_item_id,
            session_id: row.session_id,
            sender_id: row.sender_id,
            sender_type: source.sender_type,
            sender_name: source.sender_name ?? null,
            content: source.content,
            message_type: source.message_type,
            metadata: source.metadata,
            created_at: row.created_at.toISOString(),
          };
        });

        if (payloads.length <= INDIVIDUAL_BROADCAST_MAX) {
          for (const payload of payloads) {
            const event: ChatMessageReceivedServerEvent = {
              type: 'chat_message_received',
              payload,
            };
            connectionManager.broadcastToRoom(roomId, event);
          }
        } else {
          const bulkEvent: ChatMessagesBulkReceivedServerEvent = {
            type: 'chat_messages_bulk_received',
            payload: { work_item_id, messages: payloads },
          };
          connectionManager.broadcastToRoom(roomId, bulkEvent);
        }
      }

      res.json({ inserted: inserted.length, existing: conflictIds.length });
    }
  );

  return messagesRouter;
}
