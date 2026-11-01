import { randomUUID } from 'node:crypto';
import type { ServerEvent } from '@chord/protocol';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type { WebSocket } from 'ws';
import { db } from '../db/client.js';
import { presence } from '../db/schema-sharing.js';
import { workItems } from '../db/schema.js';
import type { AuthClaims } from '../middleware/auth.js';

export interface AuthenticatedWebSocket extends WebSocket {
  user: AuthClaims;
  isAlive: boolean;
  rooms: Set<string>;
  lastSeen: Date;
  // 'renderer' is every window socket (display broadcasts, presence).
  // 'device' is the Electron MAIN process's command-channel socket
  // (?device_id= on the upgrade URL): it receives commands_available
  // doorbells, joins no rooms by default, and stays entirely OUT of the
  // user-presence system — deviceConnections below is its own tracking,
  // and device liveness is its own signal (device_presence_changed).
  clientType: 'renderer' | 'device';
  // The persistent per-install id from the upgrade URL; null on renderers.
  deviceId: string | null;
}

// The presence-safe projection of a member's identity that room events carry —
// never the full AuthClaims (sessionId / permissions / orgId are authz
// internals that must not reach co-participants, cross-org or public viewers).
export interface PublicRoomUser {
  userId: string;
  email: string;
  role: string | null;
}

export function toPublicRoomUser(claims: AuthClaims): PublicRoomUser {
  return { userId: claims.userId, email: claims.email, role: claims.role };
}

const HEARTBEAT_INTERVAL_MS = 30_000;
const STALE_TIMEOUT_MS = 90_000;
// A socket whose outbound queue has grown past this isn't draining fast
// enough to keep up with live traffic (dead network peer, suspended tab,
// etc.). Crossing it does NOT mean the peer is dead — a burst of cursor
// ticks can trip it on a perfectly healthy connection — so backpressure is a
// two-stage response, not an immediate kill: see sendFrame.
const MAX_BUFFERED_BYTES = 4 * 1024 * 1024;
// High-frequency, fully superseded by the next tick — safe to drop outright
// while backpressured instead of adding to an already-overfull queue.
// Everything else (chat, notifications, work item state) keeps being sent:
// silently dropping application data is worse than a bounded memory bump.
const LOW_VALUE_EVENT_TYPES = new Set(['presence_changed', 'typing_indicator_changed']);
// How long a socket may stay over MAX_BUFFERED_BYTES before it's judged a
// dead/stuck peer rather than a momentary burst, and evicted outright. Must
// clear at least one heartbeat cycle so a single slow tick isn't fatal. The
// client's reconnect + REST catch-up (getMessages, git-state refetch, etc.)
// resynchronizes it — eviction trades a brief reconnect for bounded memory.
const EVICTION_GRACE_MS = 45_000;
// Presence consumers (useWorkItemViewers seed, /presence/online-users) treat
// rows with last_seen older than 5 minutes as ghosts from a dead server, but
// presence rows are only written on connect/update/disconnect — a diff held
// open longer than the window would vanish from every reseed. Stamp connected
// users' rows well inside the window.
const PRESENCE_REFRESH_INTERVAL_MS = 120_000;
// Fixed once per server process — distinguishes "the room_seq counters below
// are from THIS server incarnation" from a prior one. roomSeqCounters lives
// only in memory, so a restart resets every room's sequence back to 1; a
// client comparing epoch (see @chord/protocol's envelope doc) tells the
// difference between "the server restarted, my cursor is meaningless" and "I
// have a real gap within this incarnation's sequence." Mirrors the local
// turn-stream's per-session epoch (src/shared/session-stream-reducers.ts).
const SERVER_EPOCH = randomUUID();

export class ConnectionManager {
  private connections = new Map<string, Set<AuthenticatedWebSocket>>();
  // Device (main-process) sockets, keyed by userId — separate from
  // `connections` so devices never count as user presence (markUserOnline,
  // isUserOnline, org presence broadcasts all stay renderer-only) while
  // still getting heartbeats and room cleanup.
  private deviceConnections = new Map<string, Set<AuthenticatedWebSocket>>();
  // Mirrors `connections`, keyed by orgId instead of userId, so an org-scoped
  // broadcast (presence connect/disconnect) doesn't have to scan every
  // connected socket across every org to find the ones that match.
  private orgConnections = new Map<string | null, Set<AuthenticatedWebSocket>>();
  private rooms = new Map<string, Set<AuthenticatedWebSocket>>();
  // Monotonic per-room broadcast counter, stamped onto every broadcastToRoom
  // frame as room_seq (see @chord/protocol's RoomEventEnvelopeSchema). Keyed
  // by roomId independently of `rooms`'s membership lifecycle — it must keep
  // counting across a room going fully empty and being rejoined later, or a
  // returning client would see a sequence that looks like it rewound.
  private roomSeqCounters = new Map<string, number>();
  // When a socket first crossed MAX_BUFFERED_BYTES and hasn't drained back
  // under it since. Absent = not currently saturated. See sendFrame.
  private saturatedSince = new Map<AuthenticatedWebSocket, number>();
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private lastPresenceRefresh = 0;
  // Presence rows are keyed (user_id, work_item_id), not per socket, so the
  // row alone can't say which of a user's windows is advertising the cursor.
  // Track the last writer so a dying window's cursor can be cleared without
  // erasing one owned by the user's other windows. Key: `${userId}:${workItemId}`.
  private cursorWriters = new Map<string, AuthenticatedWebSocket>();
  // Reverse index: keys each socket owns in cursorWriters. Turns the O(n)
  // full-map scan on disconnect into an O(owned-keys) lookup.
  private cursorKeysBySocket = new Map<AuthenticatedWebSocket, Set<string>>();

  start(): void {
    this.heartbeatTimer = setInterval(() => this.checkHeartbeats(), HEARTBEAT_INTERVAL_MS);
  }

  stop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  addConnection(ws: AuthenticatedWebSocket): void {
    const { userId, orgId } = ws.user;
    ws.isAlive = true;
    ws.rooms = new Set();
    ws.lastSeen = new Date();

    if (ws.clientType === 'device') {
      this.addDeviceConnection(ws);
      return;
    }

    let userSockets = this.connections.get(userId);
    if (!userSockets) {
      userSockets = new Set();
      this.connections.set(userId, userSockets);
    }
    userSockets.add(ws);

    let orgSockets = this.orgConnections.get(orgId);
    if (!orgSockets) {
      orgSockets = new Set();
      this.orgConnections.set(orgId, orgSockets);
    }
    orgSockets.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
      ws.lastSeen = new Date();
    });

    this.markUserOnline(userId).catch((err) => {
      console.error('[ws] presence update failed:', err.message);
    });
    // Org teammates share no room until they open the same work item, so the
    // live online-users feed needs an org-scoped signal for connects.
    this.broadcastPresenceToOrg(ws, 'online');

    console.log(`[ws] connections: ${this.totalConnections()} (${userId} +1)`);
  }

  /**
   * Device sockets get heartbeats and (later, chat ingestion) rooms, but
   * none of the renderer presence machinery: no presence row, no org
   * online/offline broadcast, no membership in `connections`. Their liveness
   * is its own product signal — device_presence_changed to the org when the
   * user's FIRST device connects / LAST one drops, consumed as the honest
   * "agent host online" indicator on issuer status chips.
   */
  private addDeviceConnection(ws: AuthenticatedWebSocket): void {
    const { userId } = ws.user;

    let deviceSockets = this.deviceConnections.get(userId);
    const firstDevice = !deviceSockets || deviceSockets.size === 0;
    if (!deviceSockets) {
      deviceSockets = new Set();
      this.deviceConnections.set(userId, deviceSockets);
    }
    deviceSockets.add(ws);

    ws.on('pong', () => {
      ws.isAlive = true;
      ws.lastSeen = new Date();
    });

    if (firstDevice) {
      this.broadcastDevicePresence(ws, true).catch((err) => {
        console.error('[ws] device presence broadcast failed:', err.message);
      });
    }

    console.log(`[ws] device connected: ${userId} (${ws.deviceId}, ${deviceSockets.size} total)`);
  }

  joinRoom(ws: AuthenticatedWebSocket, roomId: string): void {
    let roomSockets = this.rooms.get(roomId);
    if (!roomSockets) {
      roomSockets = new Set();
      this.rooms.set(roomId, roomSockets);
    }
    roomSockets.add(ws);
    ws.rooms.add(roomId);

    console.log(`[ws] ${ws.user.userId} joined room ${roomId} (${roomSockets.size} in room)`);
  }

  leaveRoom(ws: AuthenticatedWebSocket, roomId: string): void {
    const roomSockets = this.rooms.get(roomId);
    if (roomSockets) {
      roomSockets.delete(ws);
      if (roomSockets.size === 0) {
        this.rooms.delete(roomId);
      }
    }
    ws.rooms.delete(roomId);
  }

  /**
   * Frames this sends are stamped with room_seq (this room's monotonic
   * counter, see roomSeqCounters) and epoch (this process's SERVER_EPOCH) —
   * the ONLY broadcast path that is, since it's the only one with a
   * meaningful per-room sequence. Stamped even when a specific socket is
   * excluded (e.g. the sender of a chat message): the sequence numbers a
   * room's true event order, not what any one recipient happened to receive.
   */
  broadcastToRoom(roomId: string, event: ServerEvent, exclude?: AuthenticatedWebSocket): void {
    const roomSockets = this.rooms.get(roomId);
    if (!roomSockets) return;

    const message = JSON.stringify(this.stampRoomEnvelope(roomId, event));
    for (const ws of roomSockets) {
      if (ws !== exclude) {
        this.sendFrame(ws, event.type, message);
      }
    }
  }

  /**
   * Consumes a sequence number only for events a client can actually account
   * for: both gap detectors (sync-socket-provider.tsx, device-socket-service
   * .ts) key their per-room cursor off a TOP-LEVEL work_item_id in the
   * payload, so a frame without one is invisible to them. Burning a sequence
   * number on such a frame makes the next tracked frame look like a skipped
   * broadcast — exactly how ordinary member_joined / member_left churn used
   * to trigger a full reseed storm. Enforced here rather than at each call
   * site so a new event type cannot reintroduce it (see the envelope doc in
   * @chord/protocol).
   */
  private stampRoomEnvelope(roomId: string, event: ServerEvent): ServerEvent {
    const payload: unknown = event.payload;
    const workItemId =
      typeof payload === 'object' && payload !== null
        ? (payload as { work_item_id?: unknown }).work_item_id
        : undefined;
    if (typeof workItemId !== 'string') return event;
    return { ...event, room_seq: this.nextRoomSeq(roomId), epoch: SERVER_EPOCH };
  }

  private nextRoomSeq(roomId: string): number {
    const next = (this.roomSeqCounters.get(roomId) ?? 0) + 1;
    this.roomSeqCounters.set(roomId, next);
    return next;
  }

  /**
   * Announces a departure ONLY when the user has no renderer socket left in
   * the room. Peers key presence by user_id, not by socket, so a user with
   * two windows open on the same work item would otherwise have their viewer
   * chip cleared for everyone the moment they closed one of them. Call AFTER
   * leaveRoom — the check reads current membership.
   *
   * Device sockets are excluded from the count for the same reason
   * getRoomMembers filters them: they are transport for chat ingestion, not
   * presence, and their join was never announced either.
   */
  announceMemberLeft(userId: string, roomId: string): void {
    if (this.hasUserInRoom(userId, roomId)) return;
    this.broadcastToRoom(roomId, { type: 'member_left', payload: { roomId, userId } });
  }

  private hasUserInRoom(userId: string, roomId: string): boolean {
    const roomSockets = this.rooms.get(roomId);
    if (!roomSockets) return false;
    for (const ws of roomSockets) {
      if (ws.clientType === 'device') continue;
      if (ws.user.userId === userId) return true;
    }
    return false;
  }

  /**
   * Guards every outbound frame against an unbounded send queue. Two-stage
   * policy once bufferedAmount exceeds MAX_BUFFERED_BYTES: (1) low-value
   * frame types (LOW_VALUE_EVENT_TYPES) are dropped immediately — cheap to
   * lose, the next tick supersedes them, and dropping them is the fastest way
   * to relieve a transient burst without losing anything; (2) everything else
   * still sends (silently dropping chat/notification data is worse than a
   * bounded memory bump) UNLESS the socket has stayed saturated continuously
   * past EVICTION_GRACE_MS, in which case it's judged a dead/stuck peer and
   * terminated outright — the client's reconnect + REST catch-up resyncs it.
   */
  private sendFrame(ws: AuthenticatedWebSocket, eventType: string, message: string): void {
    if (ws.readyState !== ws.OPEN) return;

    if (ws.bufferedAmount <= MAX_BUFFERED_BYTES) {
      this.saturatedSince.delete(ws);
      ws.send(message);
      return;
    }

    const since = this.saturatedSince.get(ws);
    if (since === undefined) {
      this.saturatedSince.set(ws, Date.now());
    } else if (Date.now() - since > EVICTION_GRACE_MS) {
      console.warn(
        `[ws] evicting saturated connection: ${ws.user.userId} (bufferedAmount=${ws.bufferedAmount}, saturatedForMs=${Date.now() - since})`
      );
      this.saturatedSince.delete(ws);
      ws.terminate();
      return;
    }

    if (LOW_VALUE_EVENT_TYPES.has(eventType)) return;
    ws.send(message);
  }

  /**
   * Kicks every socket of a user out of a room (e.g. after the creator removed
   * them as a participant): the kicked sockets are told via removed_from_room,
   * the remaining room members via member_left.
   *
   * Sources the target sockets from the room's ACTUAL membership
   * (`this.rooms`), not `this.connections` — the latter holds renderer sockets
   * only, so a device (main-process) socket joined for chat ingestion would
   * never be evicted, leaving a de-scoped user a live read AND write channel
   * into the room after revocation. `this.rooms` contains every socket in the
   * room, device sockets included, so filtering it by userId catches them all.
   */
  removeUserFromRoom(userId: string, roomId: string): void {
    const roomSockets = this.rooms.get(roomId);
    if (!roomSockets) return;

    const message = JSON.stringify({ type: 'removed_from_room', payload: { roomId } });
    let removed = false;
    // Snapshot before iterating: leaveRoom mutates roomSockets (and deletes the
    // room entry once it empties) as we go.
    for (const ws of [...roomSockets]) {
      if (ws.user.userId !== userId) continue;
      this.leaveRoom(ws, roomId);
      removed = true;
      this.sendFrame(ws, 'removed_from_room', message);
    }

    if (removed) {
      this.announceMemberLeft(userId, roomId);
      console.log(`[ws] ${userId} removed from room ${roomId}`);
    }
  }

  broadcastToUser(userId: string, event: ServerEvent): void {
    const userSockets = this.connections.get(userId);
    if (!userSockets) return;

    const message = JSON.stringify(event);
    for (const ws of userSockets) {
      this.sendFrame(ws, event.type, message);
    }
  }

  /**
   * Tells every other connected socket in the user's org that they came
   * online / went offline (work_item_id null = not scoped to a work item).
   * Sourced from orgConnections (not a scan of every connection across every
   * org) so this stays O(the source's own org) regardless of total traffic.
   */
  private broadcastPresenceToOrg(source: AuthenticatedWebSocket, status: 'online' | 'offline') {
    const orgSockets = this.orgConnections.get(source.user.orgId);
    if (!orgSockets) return;

    const message = JSON.stringify({
      type: 'presence_changed',
      payload: {
        user_id: source.user.userId,
        work_item_id: null,
        status,
        cursor_position: null,
        active_view: null,
        last_seen: new Date().toISOString(),
      },
    });

    for (const ws of orgSockets) {
      if (ws.user.userId === source.user.userId) continue;
      this.sendFrame(ws, 'presence_changed', message);
    }
  }

  handleDisconnect(ws: AuthenticatedWebSocket): void {
    const { userId } = ws.user;

    if (ws.clientType === 'device') {
      this.handleDeviceDisconnect(ws);
      return;
    }

    // Mirror the leave_room handler: remaining members must learn the user
    // left (viewing-presence chips and member lists clear on member_left) —
    // a disconnect must not be quieter than an explicit leave. Announced only
    // when this was the user's LAST socket in the room (announceMemberLeft):
    // closing one of two windows must not clear their chip for peers.
    for (const roomId of ws.rooms) {
      this.leaveRoom(ws, roomId);
      this.announceMemberLeft(userId, roomId);
    }

    // markUserOffline below only runs when the user's LAST socket goes, so a
    // dying window's cursor row would otherwise stay online (and the liveness
    // refresh would keep it alive) while the user's other windows remain
    // connected. member_left clears live chips; this keeps REST seeds from
    // resurrecting the ghost.
    const ownedKeys = this.cursorKeysBySocket.get(ws);
    if (ownedKeys) {
      for (const key of ownedKeys) {
        if (this.cursorWriters.get(key) === ws) {
          this.cursorWriters.delete(key);
          const workItemId = key.slice(userId.length + 1);
          this.clearWorkItemCursor(userId, workItemId).catch((err) => {
            console.error('[ws] presence cursor clear failed:', err.message);
          });
        }
      }
      this.cursorKeysBySocket.delete(ws);
    }

    this.saturatedSince.delete(ws);

    const orgSockets = this.orgConnections.get(ws.user.orgId);
    if (orgSockets) {
      orgSockets.delete(ws);
      if (orgSockets.size === 0) {
        this.orgConnections.delete(ws.user.orgId);
      }
    }

    const userSockets = this.connections.get(userId);
    if (userSockets) {
      userSockets.delete(ws);
      if (userSockets.size === 0) {
        this.connections.delete(userId);
        this.markUserOffline(userId).catch((err) => {
          console.error('[ws] presence update failed:', err.message);
        });
        this.broadcastPresenceToOrg(ws, 'offline');
      }
    }

    console.log(`[ws] connections: ${this.totalConnections()} (${userId} -1)`);
  }

  private handleDeviceDisconnect(ws: AuthenticatedWebSocket): void {
    const { userId } = ws.user;

    // Devices join rooms for chat ingestion, but silently — no member_joined
    // was broadcast on join (see server.ts's join_room handler), so no
    // member_left here either: a member_left for a user whose renderer is
    // still in the room would clear their live viewer chips.
    for (const roomId of ws.rooms) {
      this.leaveRoom(ws, roomId);
    }

    this.saturatedSince.delete(ws);

    const deviceSockets = this.deviceConnections.get(userId);
    if (deviceSockets) {
      deviceSockets.delete(ws);
      if (deviceSockets.size === 0) {
        this.deviceConnections.delete(userId);
        this.broadcastDevicePresence(ws, false).catch((err) => {
          console.error('[ws] device presence broadcast failed:', err.message);
        });
      }
    }

    console.log(`[ws] device disconnected: ${userId} (${ws.deviceId})`);
  }

  /**
   * Delivers a frame to every DEVICE socket of a user — the commands_available
   * doorbell path. Thin pings only by convention (the device fetches over
   * REST); missed delivery is fine, the device also polls on an interval.
   */
  broadcastToUserDevices(userId: string, event: ServerEvent): void {
    const deviceSockets = this.deviceConnections.get(userId);
    if (!deviceSockets) return;

    const message = JSON.stringify(event);
    for (const ws of deviceSockets) {
      this.sendFrame(ws, event.type, message);
    }
  }

  /** The honest "agent host online" signal — no session registry needed. */
  hasDeviceOnline(userId: string): boolean {
    const deviceSockets = this.deviceConnections.get(userId);
    return !!deviceSockets && deviceSockets.size > 0;
  }

  /**
   * Room-scoped, NOT org-scoped: participants are routinely cross-org
   * (share-by-email), so an org broadcast would miss exactly the teammates
   * whose "agent host online" chips need this. Broadcast into every room of
   * a work item this user CREATED — the rooms where their device liveness
   * means something. Costs one DB query per first-connect/last-disconnect
   * (not per socket event); members not currently in a room converge via
   * creator_device_online on the work-item GET.
   */
  private async broadcastDevicePresence(
    source: AuthenticatedWebSocket,
    online: boolean
  ): Promise<void> {
    const created = await db
      .select({ id: workItems.id })
      .from(workItems)
      .where(eq(workItems.creator_id, source.user.userId));

    // Per-room payloads each carry their own top-level work_item_id — the
    // renderer's room-scoped dispatch keys on it (see @chord/protocol ServerEventPayloadMap).
    for (const { id } of created) {
      this.broadcastToRoom(`work_item:${id}`, {
        type: 'device_presence_changed',
        payload: { user_id: source.user.userId, work_item_id: id, online },
      });
    }
  }

  getRoomMembers(roomId: string): PublicRoomUser[] {
    const roomSockets = this.rooms.get(roomId);
    if (!roomSockets) return [];

    const seen = new Set<string>();
    const members: PublicRoomUser[] = [];
    for (const ws of roomSockets) {
      // Device sockets are transport, not presence (chat ingestion joins
      // them to every local work item's room): counting one as a member
      // would show the owner as "viewing" with every window closed, and
      // make the chat relay skip owner renderers that aren't in the room.
      if (ws.clientType === 'device') continue;
      if (!seen.has(ws.user.userId)) {
        seen.add(ws.user.userId);
        members.push(toPublicRoomUser(ws.user));
      }
    }
    return members;
  }

  /**
   * Every distinct userId with a socket in the room, INCLUDING device
   * (main-process) sockets — the deliberate opposite of getRoomMembers, which
   * drops devices because they are transport for presence/chat-relay. Access
   * revocation (e.g. a sharing-level narrowing) must see a device-only user as
   * a room occupant, or their command channel survives the eviction sweep.
   */
  getRoomUserIds(roomId: string): string[] {
    const roomSockets = this.rooms.get(roomId);
    if (!roomSockets) return [];

    const userIds = new Set<string>();
    for (const ws of roomSockets) {
      userIds.add(ws.user.userId);
    }
    return [...userIds];
  }

  isUserOnline(userId: string): boolean {
    const sockets = this.connections.get(userId);
    return !!sockets && sockets.size > 0;
  }

  totalConnections(): number {
    let count = 0;
    for (const sockets of this.connections.values()) {
      count += sockets.size;
    }
    return count;
  }

  private checkHeartbeats(): void {
    const now = Date.now();
    // Device sockets need the same liveness policing as renderers — a dead
    // device socket that's never terminated would hold hasDeviceOnline true
    // forever, lying to every issuer's "agent host online" chip.
    for (const socketMap of [this.connections, this.deviceConnections]) {
      for (const [userId, sockets] of socketMap) {
        for (const ws of sockets) {
          if (!ws.isAlive && now - ws.lastSeen.getTime() > STALE_TIMEOUT_MS) {
            console.log(`[ws] terminating stale connection: ${userId}`);
            ws.terminate();
            continue;
          }
          ws.isAlive = false;
          ws.ping();
        }
      }
    }

    if (now - this.lastPresenceRefresh >= PRESENCE_REFRESH_INTERVAL_MS) {
      this.lastPresenceRefresh = now;
      this.refreshPresenceLiveness().catch((err) => {
        console.error('[ws] presence liveness refresh failed:', err.message);
      });
    }
  }

  /** One batched stamp per interval for every connected user's online rows. */
  private async refreshPresenceLiveness(): Promise<void> {
    const userIds = [...this.connections.keys()];
    if (userIds.length === 0) return;
    await db
      .update(presence)
      .set({ last_seen: new Date() })
      .where(and(inArray(presence.user_id, userIds), eq(presence.status, 'online')));
  }

  /** Called on every cursor-bearing presence_update so disconnects know the owner. */
  trackCursorWrite(ws: AuthenticatedWebSocket, workItemId: string, hasCursor: boolean): void {
    const key = `${ws.user.userId}:${workItemId}`;
    if (hasCursor) {
      this.cursorWriters.set(key, ws);
      let keys = this.cursorKeysBySocket.get(ws);
      if (!keys) {
        keys = new Set();
        this.cursorKeysBySocket.set(ws, keys);
      }
      keys.add(key);
    } else {
      this.cursorWriters.delete(key);
      this.cursorKeysBySocket.get(ws)?.delete(key);
    }
  }

  private async clearWorkItemCursor(userId: string, workItemId: string): Promise<void> {
    await db
      .update(presence)
      .set({ cursor_position: null, active_view: null, last_seen: new Date() })
      .where(and(eq(presence.user_id, userId), eq(presence.work_item_id, workItemId)));
  }

  /** Upserts the user's work-item-agnostic presence row (work_item_id NULL). */
  private async markUserOnline(userId: string): Promise<void> {
    await db
      .insert(presence)
      .values({
        user_id: userId,
        status: 'online',
        last_seen: new Date(),
      })
      .onConflictDoUpdate({
        target: presence.user_id,
        targetWhere: sql`${presence.work_item_id} is null`,
        set: { status: 'online', last_seen: new Date() },
      });
  }

  /**
   * Runs when the user's last socket disconnects: they are offline
   * everywhere, so every presence row (per-work-item and NULL) flips.
   */
  private async markUserOffline(userId: string): Promise<void> {
    await db
      .update(presence)
      .set({ status: 'offline', last_seen: new Date() })
      .where(eq(presence.user_id, userId));
  }
}
