import type { CloudChatMessage } from '@chord/protocol';
import { classifySeq } from '@shared/session-stream-reducers';
import { chordAccountService } from '@main/core/account/services/chord-account-service';
import {
  ingestCloudChatMessage,
  reseedWorkItemChat,
} from '@main/core/chat-messages/chat-ingestion';
import { db } from '@main/db/client';
import { workItems } from '@main/db/schema-work-items';
import type { IDisposable, IInitializable } from '@main/lib/lifecycle';
import { log } from '@main/lib/logger';
import { getDeviceId } from './cloud-commands-client';
import { commandInboxService } from './command-inbox-service';

// Mirrors the renderer's sync socket cadence (sync-socket-provider.tsx):
// quick first retry, exponential to a ceiling. Signed-out is not an error —
// poll gently until a session exists, and account/controller.ts kicks us
// the moment sign-in completes.
const RECONNECT_BASE_MS = 2_000;
const RECONNECT_MAX_MS = 60_000;
const SIGNED_OUT_RETRY_MS = 30_000;
// Re-attempt room joins on this interval while connected: work items created
// after connect, and items whose cloud row (hence checkAccess) only appeared
// once the sync-queue pushed them, get joined without waiting for a
// reconnect. Idempotent server-side; already-joined rooms are skipped here.
const ROOM_REFRESH_MS = 60_000;
// The server budgets each socket at 60 inbound messages per second and
// disconnects one that stays over budget for 3 consecutive windows
// (server/src/middleware/rate-limit.ts). A machine with more local work items
// than that would spend its entire budget joining rooms the instant it
// connected, so the joins go out in windows instead of one burst.
const JOIN_BATCH = 30;
const JOIN_BATCH_INTERVAL_MS = 1_000;

const WORK_ITEM_ROOM_PREFIX = 'work_item:';

interface DeviceFrame {
  type?: string;
  payload?: unknown;
  // Present only on frames sent through the server's broadcastToRoom — see
  // @chord/protocol's RoomEventEnvelopeSchema doc.
  room_seq?: number;
  epoch?: string;
}

function cloudWsUrl(): string {
  // Derived from the REST base rather than a second env var: the server
  // mounts /ws on the same origin (server.ts's upgrade handler), so the two
  // can never point at different deployments.
  const base = process.env.CHORD_CLOUD_API_URL?.trim();
  if (!base) throw new Error('CHORD_CLOUD_API_URL is not configured');
  return `${base.replace(/^http/, 'ws').replace(/\/$/, '')}/ws`;
}

/**
 * The main process's own WebSocket to the sync server, tagged as a DEVICE
 * socket (?device_id=). It does exactly two things (design doc §3): kick the
 * command inbox when a commands_available doorbell arrives, and forward room
 * frames for chat ingestion (§4). No business logic lives here — ingestion
 * is chat-ingestion.ts, execution is command-inbox-service.ts.
 *
 * Room membership: every local work item's room is joined on connect and
 * re-attempted on an interval (denied joins — items not cloud-visible yet —
 * simply retry). Frames the socket misses anyway are recovered by the REST
 * reseed, triggered on every room (re)join and on a room-seq gap (the same
 * classifySeq the renderer's provider uses).
 *
 * Uses the Node/Electron global WebSocket (Electron 40 ships it natively) —
 * no ws dependency; the renderer uses the same browser API.
 */
class DeviceSocketService implements IInitializable, IDisposable {
  private socket: WebSocket | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private roomRefreshTimer: ReturnType<typeof setInterval> | null = null;
  // Rooms waiting to be joined, drained in JOIN_BATCH-sized windows so a
  // machine with many local work items can't blow the server's per-socket
  // message budget the instant it connects.
  private joinQueue: string[] = [];
  private joinTimer: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  private disposed = false;
  // Rooms confirmed by room_joined on the CURRENT socket; cleared on
  // disconnect (server-side membership died with the connection).
  private joinedRooms = new Set<string>();
  // Joins sent on the current socket and not yet answered — stops the
  // refresh tick from resending while the server is still deciding.
  private pendingJoins = new Set<string>();
  // Per-room {epoch, endSeq} gap-detection cursor. Deliberately NOT cleared
  // on disconnect (same reasoning as the renderer provider): a reconnect's
  // first frame carrying a higher seq than the stale cursor is a real gap —
  // though here every rejoin reseeds anyway, so this is belt-and-braces.
  private roomCursors = new Map<string, { epoch: string; endSeq: number }>();
  // Work items with a reseed in flight — a gap during a reseed must not
  // stack a second concurrent walk over the same pages.
  private reseeding = new Set<string>();

  initialize(): void {
    this.scheduleConnect(0);
  }

  dispose(): void {
    this.disposed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.clearJoinQueue();
    this.stopRoomRefresh();
    this.socket?.close();
    this.socket = null;
  }

  /** Sign-in just completed — connect now instead of waiting out a backoff. */
  kick(): void {
    if (this.disposed || this.socket) return;
    this.attempts = 0;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.scheduleConnect(0);
  }

  private scheduleConnect(delayMs: number): void {
    if (this.disposed || this.reconnectTimer) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delayMs);
  }

  private async connect(): Promise<void> {
    if (this.disposed || this.socket) return;

    try {
      const session = await chordAccountService.getSession();
      if (!session.isSignedIn) {
        this.scheduleConnect(SIGNED_OUT_RETRY_MS);
        return;
      }
      // A fresh token per attempt — tokens live minutes, connections live
      // hours; the socket only needs the token valid at upgrade time.
      const token = await chordAccountService.getAccessToken();
      if (!token) {
        this.scheduleConnect(SIGNED_OUT_RETRY_MS);
        return;
      }
      const deviceId = await getDeviceId();

      const socket = new WebSocket(`${cloudWsUrl()}?device_id=${encodeURIComponent(deviceId)}`, [
        `auth-${token}`,
      ]);
      this.socket = socket;

      socket.onopen = () => {
        this.attempts = 0;
        log.info('[commands] device socket connected');
        // Fetch on reconnect: doorbells rung while offline were lost, the
        // durable rows behind them were not.
        commandInboxService.kick();
        // Chat has the same recovery shape: join every local work item's
        // room; each room_joined triggers that item's REST reseed.
        this.joinLocalWorkItemRooms();
        this.startRoomRefresh();
      };
      socket.onmessage = (event) => {
        this.handleFrame(typeof event.data === 'string' ? event.data : '');
      };
      socket.onclose = () => this.handleDisconnect();
      socket.onerror = () => {
        // onclose always follows onerror; reconnect is handled there.
      };
    } catch (e) {
      log.warn('[commands] device socket connect failed:', e instanceof Error ? e.message : e);
      this.socket = null;
      this.backoff();
    }
  }

  private handleDisconnect(): void {
    this.socket = null;
    this.joinedRooms.clear();
    this.pendingJoins.clear();
    this.clearJoinQueue();
    this.stopRoomRefresh();
    if (!this.disposed) this.backoff();
  }

  private clearJoinQueue(): void {
    if (this.joinTimer) clearTimeout(this.joinTimer);
    this.joinTimer = null;
    this.joinQueue = [];
  }

  private backoff(): void {
    const delay = Math.min(RECONNECT_BASE_MS * 2 ** this.attempts, RECONNECT_MAX_MS);
    this.attempts += 1;
    this.scheduleConnect(delay);
  }

  private startRoomRefresh(): void {
    if (this.roomRefreshTimer) return;
    this.roomRefreshTimer = setInterval(() => this.joinLocalWorkItemRooms(), ROOM_REFRESH_MS);
  }

  private stopRoomRefresh(): void {
    if (this.roomRefreshTimer) clearInterval(this.roomRefreshTimer);
    this.roomRefreshTimer = null;
  }

  /**
   * Joins one work item's room now — called the moment its cloud create is
   * confirmed (work-item-cloud-created.ts), so the room is joined while its
   * first messages are being sent rather than on the next sweep. The join's
   * reseed recovers whatever was broadcast before it. Disconnected, it does
   * nothing: the connect joins every local item.
   */
  joinWorkItemRoom(workItemId: string): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    this.queueRoomJoin(workItemId);
    if (this.joinTimer === null) this.drainJoinQueue(socket);
  }

  private joinLocalWorkItemRooms(): void {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    const localIds = db.select({ id: workItems.id }).from(workItems).all();
    for (const { id } of localIds) this.queueRoomJoin(id);
    if (this.joinTimer === null) this.drainJoinQueue(socket);
  }

  private queueRoomJoin(workItemId: string): void {
    const roomId = `${WORK_ITEM_ROOM_PREFIX}${workItemId}`;
    if (this.joinedRooms.has(roomId) || this.pendingJoins.has(roomId)) return;
    if (this.joinQueue.includes(roomId)) return;
    this.joinQueue.push(roomId);
  }

  /** Sends at most JOIN_BATCH joins per window — see JOIN_BATCH. */
  private drainJoinQueue(socket: WebSocket): void {
    this.joinTimer = null;
    if (this.disposed || this.socket !== socket || socket.readyState !== WebSocket.OPEN) {
      this.joinQueue = [];
      return;
    }
    for (const roomId of this.joinQueue.splice(0, JOIN_BATCH)) {
      this.pendingJoins.add(roomId);
      socket.send(JSON.stringify({ type: 'join_room', payload: { roomId } }));
    }
    if (this.joinQueue.length > 0) {
      this.joinTimer = setTimeout(() => this.drainJoinQueue(socket), JOIN_BATCH_INTERVAL_MS);
    }
  }

  private handleFrame(raw: string): void {
    if (!raw) return;
    let frame: DeviceFrame;
    try {
      frame = JSON.parse(raw) as DeviceFrame;
    } catch (e) {
      // The socket carries only server-generated JSON, so a frame that won't
      // parse is a real protocol fault (a truncated send, a version skew) —
      // dropping it silently made that invisible. Nothing is thrown: this
      // runs inside the socket's onmessage, where a throw would take the
      // connection down over one bad frame instead of the next one recovering.
      log.error(
        '[commands] device socket dropped unparseable frame:',
        e instanceof Error ? e.message : e
      );
      return;
    }

    this.trackRoomSeq(frame);

    switch (frame.type) {
      case 'commands_available':
        commandInboxService.kick();
        return;
      case 'room_joined': {
        const roomId = (frame.payload as { roomId?: unknown } | null)?.roomId;
        if (typeof roomId !== 'string') return;
        this.pendingJoins.delete(roomId);
        this.joinedRooms.add(roomId);
        // Everything broadcast while this device wasn't in the room is
        // recoverable only over REST — reseed on every (re)join.
        this.reseed(roomId.slice(WORK_ITEM_ROOM_PREFIX.length));
        return;
      }
      case 'room_join_denied': {
        const roomId = (frame.payload as { roomId?: unknown } | null)?.roomId;
        if (typeof roomId === 'string') this.pendingJoins.delete(roomId);
        return;
      }
      case 'removed_from_room': {
        const roomId = (frame.payload as { roomId?: unknown } | null)?.roomId;
        if (typeof roomId !== 'string') return;
        this.pendingJoins.delete(roomId);
        this.joinedRooms.delete(roomId);
        return;
      }
      case 'chat_message_received':
        this.ingest(frame.payload as CloudChatMessage);
        return;
      case 'chat_messages_bulk_received': {
        const payload = frame.payload as { messages?: CloudChatMessage[] } | null;
        for (const message of payload?.messages ?? []) this.ingest(message);
        return;
      }
      default:
        // Presence, typing, member churn, command status — display concerns;
        // the device deliberately ignores them (they still advanced the
        // room-seq cursor above, which is all gap detection needs).
        return;
    }
  }

  private ingest(message: CloudChatMessage): void {
    try {
      ingestCloudChatMessage(message);
    } catch (e) {
      log.warn('[commands] chat ingest failed:', e instanceof Error ? e.message : e);
    }
  }

  /**
   * The renderer provider's gap detection (sync-socket-provider.tsx),
   * transplanted: only broadcastToRoom frames carry room_seq/epoch; a 'gap'
   * means a broadcast to this room was missed without a disconnect, and the
   * recovery is that work item's REST reseed. The frame itself is still
   * processed by the caller regardless — ingestion is id-idempotent.
   */
  private trackRoomSeq(frame: DeviceFrame): void {
    const workItemId = (frame.payload as { work_item_id?: unknown } | null)?.work_item_id;
    if (
      typeof workItemId !== 'string' ||
      typeof frame.room_seq !== 'number' ||
      typeof frame.epoch !== 'string'
    ) {
      return;
    }
    const roomId = `${WORK_ITEM_ROOM_PREFIX}${workItemId}`;
    const cursor = this.roomCursors.get(roomId) ?? null;
    const decision = classifySeq(cursor, frame.epoch, frame.room_seq);
    if (decision === 'gap') {
      this.reseed(workItemId);
    }
    if (decision !== 'drop_stale') {
      this.roomCursors.set(roomId, { epoch: frame.epoch, endSeq: frame.room_seq });
    }
  }

  private reseed(workItemId: string): void {
    if (this.reseeding.has(workItemId)) return;
    this.reseeding.add(workItemId);
    reseedWorkItemChat(workItemId)
      .catch((e) => {
        // Recoverable by the next join/gap trigger — the cloud rows are
        // durable and ingestion is idempotent.
        log.warn('[commands] chat reseed failed:', e instanceof Error ? e.message : e);
      })
      .finally(() => {
        this.reseeding.delete(workItemId);
      });
  }
}

export const deviceSocketService = new DeviceSocketService();
