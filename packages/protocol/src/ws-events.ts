import { z } from 'zod';
import {
  ArtifactAccessChangedServerEventSchema,
  ArtifactDeletedServerEventSchema,
  ArtifactRegisteredServerEventSchema,
  ArtifactVersionCreatedServerEventSchema,
  CommandsAvailableServerEventSchema,
  CommandUpdatedServerEventSchema,
  CommentCreatedServerEventSchema,
  DevicePresenceChangedServerEventSchema,
  ErrorServerEventSchema,
  GitStateUpdatedServerEventSchema,
  ParticipantAddedServerEventSchema,
  ParticipantRemovedServerEventSchema,
  ParticipantRoleChangedServerEventSchema,
  PermissionRequestUpdatedServerEventSchema,
  PlanRequestUpdatedServerEventSchema,
  WorkItemDeletedServerEventSchema,
  WorkItemSessionsUpdatedServerEventSchema,
  WorkItemWorktreesUpdatedServerEventSchema,
} from './ws-item-events.js';
import {
  ChatMessageAckServerEventSchema,
  ChatMessageReceivedServerEventSchema,
  ChatMessagesBulkReceivedServerEventSchema,
  MemberJoinedServerEventSchema,
  MemberLeftServerEventSchema,
  NotificationReceivedServerEventSchema,
  PresenceChangedServerEventSchema,
  RemovedFromRoomServerEventSchema,
  RoomJoinDeniedServerEventSchema,
  RoomJoinedServerEventSchema,
  RoomMessageServerEventSchema,
  TypingIndicatorChangedServerEventSchema,
  WorkItemUpdatedServerEventSchema,
  type RoomUserSchema,
  type WorkItemChangesSchema,
} from './ws-room-events.js';

/**
 * The sync-socket wire contract, in both directions. This module and the
 * three it unions (ws-client-events: client to server; ws-room-events and
 * ws-item-events: server to client) are the ONE definition: the server
 * validates inbound frames and types its broadcasts against these schemas,
 * and the renderer's typed subscription map is derived from the union here
 * (see ServerEventPayloadMap) rather than restated.
 *
 * Room-scoped client dispatch extracts `work_item_id` from the TOP LEVEL of
 * the payload — any new event meant for room-scoped subscribers must carry it
 * there.
 */

// ─── Room broadcast envelope ────────────────────────────────────────────────
//
// Stamped onto every event ConnectionManager.broadcastToRoom sends — and
// ONLY those; broadcastToUser and other direct per-socket sends have no
// per-room sequence to participate in, so they carry neither field. room_seq
// is monotonic per work-item room; epoch is fixed for the life of the server
// process (see connection-manager.ts's SERVER_EPOCH).
//
// It is stamped only on frames whose payload carries a TOP-LEVEL
// work_item_id, because that is the only field a client can key its per-room
// cursor off (both the renderer provider and the device socket read exactly
// it). An event that consumed a sequence number without carrying one would be
// invisible to every gap detector, and the next tracked frame would look like
// a skipped broadcast — which is precisely how ordinary member_joined /
// member_left churn used to trigger a full reseed storm. broadcastToRoom
// enforces the rule structurally so a new event type cannot reintroduce it.
// A client tracks the highest room_seq it has applied per room: a gap
// (room_seq skips ahead) or an epoch change (server restarted, every room's
// counter reset to 1) means it may have missed or misordered a broadcast, and
// should treat its state as possibly stale rather than trust incremental
// application alone. Mirrors src/shared/session-stream-reducers.ts's local
// turn-stream {epoch, seq} cursor/gap pattern — same shape, same semantics —
// reused (via classifySeq, not reimplemented) on the renderer side in
// sync-socket-provider.tsx.
export const RoomEventEnvelopeSchema = z.object({
  room_seq: z.number().optional(),
  epoch: z.string().optional(),
});

/**
 * Every server → client event, without the room envelope. The payload map
 * below is derived from this union, so a new event type is typed on the
 * renderer the moment it is added here.
 */
export const ServerEventUnionSchema = z.discriminatedUnion('type', [
  RoomJoinedServerEventSchema,
  RoomJoinDeniedServerEventSchema,
  RemovedFromRoomServerEventSchema,
  MemberJoinedServerEventSchema,
  MemberLeftServerEventSchema,
  RoomMessageServerEventSchema,
  WorkItemUpdatedServerEventSchema,
  ChatMessageReceivedServerEventSchema,
  ChatMessagesBulkReceivedServerEventSchema,
  ChatMessageAckServerEventSchema,
  PresenceChangedServerEventSchema,
  NotificationReceivedServerEventSchema,
  TypingIndicatorChangedServerEventSchema,
  GitStateUpdatedServerEventSchema,
  WorkItemDeletedServerEventSchema,
  ParticipantAddedServerEventSchema,
  ParticipantRemovedServerEventSchema,
  ParticipantRoleChangedServerEventSchema,
  ArtifactAccessChangedServerEventSchema,
  ArtifactRegisteredServerEventSchema,
  ArtifactDeletedServerEventSchema,
  ArtifactVersionCreatedServerEventSchema,
  CommentCreatedServerEventSchema,
  CommandsAvailableServerEventSchema,
  CommandUpdatedServerEventSchema,
  DevicePresenceChangedServerEventSchema,
  PermissionRequestUpdatedServerEventSchema,
  PlanRequestUpdatedServerEventSchema,
  WorkItemWorktreesUpdatedServerEventSchema,
  WorkItemSessionsUpdatedServerEventSchema,
  ErrorServerEventSchema,
]);

export const ServerEventSchema = ServerEventUnionSchema.and(RoomEventEnvelopeSchema);

export type ServerEvent = z.infer<typeof ServerEventSchema>;
type ServerEventUnion = z.infer<typeof ServerEventUnionSchema>;

// One exported type per event schema — a broadcast site annotates itself with
// the event it emits, so a payload change is a compile error at every producer.
export type RoomJoinedServerEvent = z.infer<typeof RoomJoinedServerEventSchema>;
export type RoomJoinDeniedServerEvent = z.infer<typeof RoomJoinDeniedServerEventSchema>;
export type RemovedFromRoomServerEvent = z.infer<typeof RemovedFromRoomServerEventSchema>;
export type MemberJoinedServerEvent = z.infer<typeof MemberJoinedServerEventSchema>;
export type MemberLeftServerEvent = z.infer<typeof MemberLeftServerEventSchema>;
export type RoomMessageServerEvent = z.infer<typeof RoomMessageServerEventSchema>;
export type WorkItemUpdatedServerEvent = z.infer<typeof WorkItemUpdatedServerEventSchema>;
export type ChatMessageReceivedServerEvent = z.infer<typeof ChatMessageReceivedServerEventSchema>;
export type ChatMessagesBulkReceivedServerEvent = z.infer<
  typeof ChatMessagesBulkReceivedServerEventSchema
>;
export type ChatMessageAckServerEvent = z.infer<typeof ChatMessageAckServerEventSchema>;
export type PresenceChangedServerEvent = z.infer<typeof PresenceChangedServerEventSchema>;
export type NotificationReceivedServerEvent = z.infer<typeof NotificationReceivedServerEventSchema>;
export type TypingIndicatorChangedServerEvent = z.infer<
  typeof TypingIndicatorChangedServerEventSchema
>;
export type GitStateUpdatedServerEvent = z.infer<typeof GitStateUpdatedServerEventSchema>;
export type WorkItemDeletedServerEvent = z.infer<typeof WorkItemDeletedServerEventSchema>;
export type ParticipantAddedServerEvent = z.infer<typeof ParticipantAddedServerEventSchema>;
export type ParticipantRemovedServerEvent = z.infer<typeof ParticipantRemovedServerEventSchema>;
export type ArtifactRegisteredServerEvent = z.infer<typeof ArtifactRegisteredServerEventSchema>;
export type ArtifactDeletedServerEvent = z.infer<typeof ArtifactDeletedServerEventSchema>;
export type ArtifactVersionCreatedServerEvent = z.infer<
  typeof ArtifactVersionCreatedServerEventSchema
>;
export type ArtifactAccessChangedServerEvent = z.infer<
  typeof ArtifactAccessChangedServerEventSchema
>;
export type ParticipantRoleChangedServerEvent = z.infer<
  typeof ParticipantRoleChangedServerEventSchema
>;
export type CommentCreatedServerEvent = z.infer<typeof CommentCreatedServerEventSchema>;
export type CommandsAvailableServerEvent = z.infer<typeof CommandsAvailableServerEventSchema>;
export type CommandUpdatedServerEvent = z.infer<typeof CommandUpdatedServerEventSchema>;
export type DevicePresenceChangedServerEvent = z.infer<
  typeof DevicePresenceChangedServerEventSchema
>;
export type PermissionRequestUpdatedServerEvent = z.infer<
  typeof PermissionRequestUpdatedServerEventSchema
>;
export type PlanRequestUpdatedServerEvent = z.infer<typeof PlanRequestUpdatedServerEventSchema>;
export type WorkItemWorktreesUpdatedServerEvent = z.infer<
  typeof WorkItemWorktreesUpdatedServerEventSchema
>;
export type WorkItemSessionsUpdatedServerEvent = z.infer<
  typeof WorkItemSessionsUpdatedServerEventSchema
>;
export type ErrorServerEvent = z.infer<typeof ErrorServerEventSchema>;

export type RoomUser = z.infer<typeof RoomUserSchema>;
export type WorkItemChanges = z.infer<typeof WorkItemChangesSchema>;

/**
 * Renderer-side contract for every server → client sync-socket event, derived
 * from ServerEventUnionSchema so the two can never drift.
 *
 * Room-scoped dispatch (`${type}.${workItemId}`) extracts `work_item_id` from
 * the TOP LEVEL of the payload (sync-socket-provider.tsx) — any new event that
 * should reach room-scoped subscribers must carry it there.
 */
export type ServerEventPayloadMap = {
  [K in ServerEventUnion['type']]: Extract<ServerEventUnion, { type: K }>['payload'];
} & {
  /**
   * Synthetic channel the provider fires on every socket (re)connect, and on
   * an in-room gap detected without a disconnect (see sync-socket-provider's
   * onmessage gap detection) — either way, REST-seeded consumers reseed.
   */
  '$sync/connected': undefined;
};

export type ServerEventName = keyof ServerEventPayloadMap;

/** The payload a given event carries — `ServerEventPayload<'git_state_updated'>`. */
export type ServerEventPayload<K extends ServerEventName> = ServerEventPayloadMap[K];

/**
 * The one payload consumers hold onto as data rather than handle inline: the
 * dropdown keeps a list of them across renders.
 */
export type NotificationReceivedPayload = ServerEventPayload<'notification_received'>;
