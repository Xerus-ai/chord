import { z } from 'zod';
import { CloudChatMessageSchema } from './chat.js';
import { NotificationViewSchema } from './notifications.js';

/**
 * Server → client events of rooms, work items, chat, presence and typing
 * (split from ws-events.ts, which unions every server event).
 */

// ─── Server → Client Events ────────────────────────────────────────────────

// Only the fields a co-participant legitimately needs to render presence. The
// full AuthClaims (sessionId, permissions, orgId) are authorization internals
// and were previously broadcast to every room member — including cross-org and
// public viewers — so they are deliberately NOT part of the wire shape.
export const RoomUserSchema = z.object({
  userId: z.string(),
  email: z.string(),
  role: z.string().nullable(),
});

// Superset of every field a work_item_updated broadcast may carry (WS update
// event and REST PATCH both feed it).
export const WorkItemChangesSchema = z.object({
  name: z.string().optional(),
  status: z.string().optional(),
  workflow_phase: z.string().optional(),
  ticket_id: z.string().nullable().optional(),
  ticket_provider: z.string().nullable().optional(),
  ticket_url: z.string().nullable().optional(),
  pr_number: z.number().nullable().optional(),
  pr_url: z.string().nullable().optional(),
  repo_name: z.string().nullable().optional(),
  branch_name: z.string().nullable().optional(),
  agent_provider: z.string().nullable().optional(),
  // Who has access (P6): 'invited' | 'team', at general_role 'view' | 'edit'.
  general_access: z.enum(['invited', 'team']).optional(),
  general_role: z.enum(['view', 'edit']).optional(),
  approval_policy: z.string().optional(),
});

export const RoomJoinedServerEventSchema = z.object({
  type: z.literal('room_joined'),
  payload: z.object({
    roomId: z.string(),
    members: z.array(RoomUserSchema),
  }),
});

export const RoomJoinDeniedServerEventSchema = z.object({
  type: z.literal('room_join_denied'),
  payload: z.object({
    roomId: z.string(),
    reason: z.string(),
  }),
});

export const RemovedFromRoomServerEventSchema = z.object({
  type: z.literal('removed_from_room'),
  payload: z.object({
    roomId: z.string(),
  }),
});

export const MemberJoinedServerEventSchema = z.object({
  type: z.literal('member_joined'),
  payload: z.object({
    roomId: z.string(),
    user: RoomUserSchema,
  }),
});

export const MemberLeftServerEventSchema = z.object({
  type: z.literal('member_left'),
  payload: z.object({
    roomId: z.string(),
    userId: z.string(),
  }),
});

export const RoomMessageServerEventSchema = z.object({
  type: z.literal('room_message'),
  payload: z.looseObject({
    from: z.string(),
  }),
});

export const WorkItemUpdatedServerEventSchema = z.object({
  type: z.literal('work_item_updated'),
  payload: z.object({
    work_item_id: z.string(),
    changes: WorkItemChangesSchema,
    version_number: z.number(),
    updated_by: z.string(),
    updated_at: z.string(),
  }),
});

export const ChatMessageReceivedServerEventSchema = z.object({
  type: z.literal('chat_message_received'),
  payload: CloudChatMessageSchema,
});

// Owner history bulk push (PUT /bulk) broadcasts every newly-inserted row in
// ONE frame instead of one chat_message_received per message — without this,
// a multi-message backfill to an active room is N full JSON.stringify + N
// ws.send calls per room member. Top-level work_item_id keeps room-scoped
// dispatch working; each entry is the same shape as chat_message_received's
// payload so consumers can flatten and reuse per-message handling.
export const ChatMessagesBulkReceivedServerEventSchema = z.object({
  type: z.literal('chat_messages_bulk_received'),
  payload: z.object({
    work_item_id: z.string(),
    messages: z.array(CloudChatMessageSchema),
  }),
});

// Sent directly to the sender of a chat_message: the room broadcast excludes
// them, so this is the only frame carrying the canonical {id, created_at}
// back for optimistic-append reconciliation. Top-level work_item_id so the
// room-scoped client dispatch reaches item-scoped subscribers.
export const ChatMessageAckServerEventSchema = z.object({
  type: z.literal('chat_message_ack'),
  payload: z.object({
    id: z.string(),
    work_item_id: z.string(),
    created_at: z.string(),
  }),
});

export const PresenceChangedServerEventSchema = z.object({
  type: z.literal('presence_changed'),
  payload: z.object({
    user_id: z.string(),
    // null on the org-scoped online/offline event a connect/disconnect emits.
    work_item_id: z.string().nullable(),
    status: z.string(),
    cursor_position: z
      .object({
        file: z.string().optional(),
        line: z.number().optional(),
        column: z.number().optional(),
      })
      .nullable(),
    active_view: z.string().nullable(),
    last_seen: z.string(),
  }),
});

export const NotificationReceivedServerEventSchema = z.object({
  type: z.literal('notification_received'),
  payload: NotificationViewSchema,
});

export const TypingIndicatorChangedServerEventSchema = z.object({
  type: z.literal('typing_indicator_changed'),
  payload: z.object({
    user_id: z.string(),
    email: z.string(),
    work_item_id: z.string(),
    is_typing: z.boolean(),
  }),
});
