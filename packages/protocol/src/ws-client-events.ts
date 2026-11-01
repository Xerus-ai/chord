import { z } from 'zod';

/**
 * Client → server events on the sync socket (split from ws-events.ts, which
 * holds the server event union and the typed payload map).
 */

// ─── Client → Server Events ────────────────────────────────────────────────
//
// work_item_update and artifact_update client→server events used to live
// here (ARCH-3b removed them): grep across the renderer/main-process client
// found no sender for either — cloud work-item mutations flow only through
// REST (owner sync-queue PATCH, or the creator/write-gated routes for other
// participants), and artifact content flows entirely through Yjs/Hocuspocus,
// never this WS channel. Accepting them from any participant was unenforced
// write surface with no legitimate caller — dead protocol pretending to be a
// feature. The server→client work_item_updated broadcast stays (it's fed by
// the REST PATCH path and is consumed — see use-work-item-resolution.ts);
// artifact_updated (server→client) was removed alongside its client→server
// counterpart since ARCH-2's audit found no renderer consumer for it either.

export const ChatMessageEventSchema = z.object({
  type: z.literal('chat_message'),
  payload: z.object({
    // Client-supplied id makes sends idempotent: a retry of the same id is
    // acked with the stored row instead of inserting a duplicate.
    id: z.uuid().optional(),
    work_item_id: z.string(),
    // The thread this message was typed into. Optional because a client that
    // predates the session registry has no thread to name; the server stores
    // null for those, which renders as work-item history in every thread.
    // When present the server REJECTS the frame unless the id names a session
    // of this work item — a message addressed to a thread and delivered
    // elsewhere is a wrong answer, not a lenient one (same rule as the
    // command channel's selectCommandTargetSession).
    session_id: z.string().nullable().optional(),
    content: z.string().min(1),
    message_type: z.enum(['text', 'code', 'system']).default('text'),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
});

export const PresenceUpdateEventSchema = z.object({
  type: z.literal('presence_update'),
  payload: z.object({
    work_item_id: z.string().nullable(),
    status: z.enum(['online', 'away', 'busy', 'offline']),
    cursor_position: z
      .object({
        file: z.string().optional(),
        line: z.number().optional(),
        column: z.number().optional(),
      })
      .optional(),
    active_view: z.string().optional(),
  }),
});

export const TypingIndicatorEventSchema = z.object({
  type: z.literal('typing_indicator'),
  payload: z.object({
    work_item_id: z.string(),
    is_typing: z.boolean(),
  }),
});

export const JoinRoomEventSchema = z.object({
  type: z.literal('join_room'),
  payload: z.object({
    roomId: z.string(),
  }),
});

export const LeaveRoomEventSchema = z.object({
  type: z.literal('leave_room'),
  payload: z.object({
    roomId: z.string(),
  }),
});

export const RoomMessageEventSchema = z.object({
  type: z.literal('room_message'),
  payload: z.looseObject({
    roomId: z.string(),
  }),
});

export const ClientEventSchema = z.discriminatedUnion('type', [
  ChatMessageEventSchema,
  PresenceUpdateEventSchema,
  JoinRoomEventSchema,
  LeaveRoomEventSchema,
  RoomMessageEventSchema,
  TypingIndicatorEventSchema,
]);

export type ClientEvent = z.infer<typeof ClientEventSchema>;
export type ChatMessageEvent = z.infer<typeof ChatMessageEventSchema>;
export type PresenceUpdateEvent = z.infer<typeof PresenceUpdateEventSchema>;
export type TypingIndicatorEvent = z.infer<typeof TypingIndicatorEventSchema>;
