import type { ServerEventName, ServerEventPayloadMap } from '@chord/protocol';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  type ReactNode,
} from 'react';
import { clearCachedToken } from '@renderer/lib/cloud-fetch';
import { rpc } from '@renderer/lib/ipc';
import { createRoomRegistry, type RoomJoinStatus, type RoomLifecycleFrame } from './room-registry';
import { createRoomSeqTracker } from './room-seq-tracker';
import { clearWorkItemPresenceGate } from './work-item-presence-gate';

const SYNC_WS_BASE = import.meta.env.VITE_CLOUD_WS_URL;
const INITIAL_DELAY_MS = 2_000;
const RECONNECT_DELAY_MS = 3_000;
const WORK_ITEM_ROOM_PREFIX = 'work_item:';
// Rooms for one artifact's own events (comments), open to artifact-only members (P6).
const ARTIFACT_ROOM_PREFIX = 'artifact:';
// The server budgets each socket at 60 inbound messages per second and
// disconnects a socket that stays over budget for 3 consecutive windows
// (server/src/middleware/rate-limit.ts). A user with more shared work items
// than that would replay every held join in one burst on reconnect and spend
// its whole budget on room joins — so the replay goes out in windows, leaving
// headroom for the presence/typing traffic the same socket carries.
const JOIN_REPLAY_BATCH = 30;
const JOIN_REPLAY_INTERVAL_MS = 1_000;
// Gap detection fires per gapped FRAME. A burst that leaves several rooms
// gapped at once would otherwise dispatch one reseed signal per frame, and
// every REST-seeded consumer in the app refetches on each. Collapse a burst
// into a single signal; a genuinely later gap still gets its own.
const RESEED_SIGNAL_COALESCE_MS = 250;

interface ServerMessage {
  type: string;
  payload: unknown;
  // Present only on frames sent through ConnectionManager.broadcastToRoom —
  // see @chord/protocol's RoomEventEnvelopeSchema doc.
  room_seq?: number;
  epoch?: string;
}

export interface SyncSocketContextValue {
  /**
   * Sends a client event. Returns false when the socket is not open — the
   * event is dropped, not queued (callers send ephemeral events only; room
   * joins are held by the provider and replayed on reconnect instead).
   */
  sendEvent: (event: { type: string; payload: unknown }) => boolean;
  /**
   * Subscribes to server events by parsed WS `type`, optionally narrowed to
   * one work item (channel `${type}.${workItemId}`, same namespacing as
   * events.ts). The synthetic `$sync/connected` channel fires on every socket
   * (re)connect, AND whenever gap detection (see the onmessage handler)
   * decides a room broadcast may have been missed without a disconnect — in
   * both cases REST-seeded consumers should reseed state they may have
   * missed. Payloads are typed by ServerEventPayloadMap — new server events
   * must be added there. Returns an unsubscribe function.
   */
  subscribeEvent: <K extends ServerEventName>(
    type: K,
    cb: (payload: ServerEventPayloadMap[K]) => void,
    workItemId?: string
  ) => () => void;
  /**
   * Joins `work_item:{id}`, ref-counted across consumers, and calls
   * onStatusChange whenever the room's join status changes. The provider
   * replays every held join after a reconnect; a room the server denied or
   * removed us from is NOT retried until every holder has released it and a
   * new consumer acquires it, or this window is told someone was added to
   * the work item (`participant_added`: access may have been granted).
   * Returns a release function.
   */
  acquireWorkItemRoom: (workItemId: string, onStatusChange: () => void) => () => void;
  /**
   * Joins `artifact:{id}` with the same ref-counting and replay as a work-item
   * room — how someone an artifact was shared with alone gets its comment
   * events. Returns a release function.
   */
  acquireArtifactRoom: (artifactId: string, onStatusChange: () => void) => () => void;
  /** Current join status of `work_item:{id}`, or null when nobody holds it. */
  getWorkItemRoomStatus: (workItemId: string) => RoomJoinStatus | null;
}

const SyncSocketContext = createContext<SyncSocketContextValue | undefined>(undefined);

export function useSyncSocketService(): SyncSocketContextValue {
  // Only the open socket lives here; a connecting/reconnecting socket is not
  // observable. Everything is refs so the context value stays identical across
  // reconnects and consumer subscriptions never churn.
  const socketRef = useRef<WebSocket | null>(null);
  const channelsRef = useRef<Map<string, Set<(payload: unknown) => void>>>(new Map());
  // Per-room {epoch, seq} cursors for gap detection — see room-seq-tracker.ts
  // for why they survive a disconnect.
  const roomSeqTrackerRef = useRef(createRoomSeqTracker());

  const sendEvent = useCallback((event: { type: string; payload: unknown }): boolean => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(event));
    return true;
  }, []);
  const rooms = useMemo(
    () =>
      createRoomRegistry({
        sendJoin: (roomId) => void sendEvent({ type: 'join_room', payload: { roomId } }),
        sendLeave: (roomId) => void sendEvent({ type: 'leave_room', payload: { roomId } }),
      }),
    [sendEvent]
  );

  const subscribeEvent = useCallback(
    <K extends ServerEventName>(
      type: K,
      cb: (payload: ServerEventPayloadMap[K]) => void,
      workItemId?: string
    ): (() => void) => {
      const channel = workItemId ? `${type}.${workItemId}` : type;
      const channels = channelsRef.current;
      let subscribers = channels.get(channel);
      if (!subscribers) {
        subscribers = new Set();
        channels.set(channel, subscribers);
      }
      const set = subscribers;
      const wrapped = (payload: unknown) => cb(payload as ServerEventPayloadMap[K]);
      set.add(wrapped);
      return () => {
        set.delete(wrapped);
        if (set.size === 0) channels.delete(channel);
      };
    },
    []
  );

  const acquireRoom = useCallback(
    (roomId: string, onStatusChange: () => void): (() => void) =>
      rooms.acquire(roomId, onStatusChange),
    [rooms]
  );

  const acquireWorkItemRoom = useCallback(
    (workItemId: string, onStatusChange: () => void) =>
      acquireRoom(`${WORK_ITEM_ROOM_PREFIX}${workItemId}`, onStatusChange),
    [acquireRoom]
  );

  const acquireArtifactRoom = useCallback(
    (artifactId: string, onStatusChange: () => void) =>
      acquireRoom(`${ARTIFACT_ROOM_PREFIX}${artifactId}`, onStatusChange),
    [acquireRoom]
  );

  const getWorkItemRoomStatus = useCallback(
    (workItemId: string): RoomJoinStatus | null =>
      rooms.status(`${WORK_ITEM_ROOM_PREFIX}${workItemId}`),
    [rooms]
  );

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let joinReplayTimer: ReturnType<typeof setTimeout> | null = null;
    let joinReplayQueue: string[] = [];
    let reseedSignalTimer: ReturnType<typeof setTimeout> | null = null;
    let authFailCount = 0;

    const dispatch = (channel: string, payload: unknown): void => {
      const subscribers = channelsRef.current.get(channel);
      if (!subscribers) return;
      for (const cb of subscribers) {
        try {
          cb(payload);
        } catch (err) {
          console.error('[sync-ws] subscriber failed:', err);
        }
      }
    };

    const handleRoomLifecycle = (message: ServerMessage): void => {
      const roomId = (message.payload as { roomId?: unknown } | null)?.roomId;
      if (typeof roomId !== 'string') return;
      rooms.applyLifecycle(roomId, message.type as RoomLifecycleFrame);
      // A granted join is proof the cloud row exists, so presence polling that
      // parked itself on a 404 while the work item was still local can resume
      // now rather than sitting out the rest of its backoff.
      if (rooms.status(roomId) === 'joined' && roomId.startsWith(WORK_ITEM_ROOM_PREFIX)) {
        clearWorkItemPresenceGate(roomId.slice(WORK_ITEM_ROOM_PREFIX.length));
      }
    };

    // Drains joinReplayQueue JOIN_REPLAY_BATCH rooms at a time, staying under
    // the server's per-socket message budget. Bound to the socket it started
    // for, so a queue left over from a socket that has since closed is
    // dropped rather than replayed onto the wrong connection.
    const drainJoinReplay = (socket: WebSocket): void => {
      joinReplayTimer = null;
      if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) {
        joinReplayQueue = [];
        return;
      }
      for (const roomId of joinReplayQueue.splice(0, JOIN_REPLAY_BATCH)) {
        socket.send(JSON.stringify({ type: 'join_room', payload: { roomId } }));
      }
      if (joinReplayQueue.length > 0) {
        joinReplayTimer = setTimeout(() => drainJoinReplay(socket), JOIN_REPLAY_INTERVAL_MS);
      }
    };

    const scheduleReseedSignal = (): void => {
      if (reseedSignalTimer !== null) return;
      reseedSignalTimer = setTimeout(() => {
        reseedSignalTimer = null;
        dispatch('$sync/connected', undefined);
      }, RESEED_SIGNAL_COALESCE_MS);
    };

    async function connect(): Promise<void> {
      if (disposed) return;

      const session = await rpc.account.getSession();
      if (disposed) return;
      if (!session.isSignedIn) {
        reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
        return;
      }

      clearCachedToken();
      const token = await rpc.account.getAccessToken();
      if (disposed) return;
      if (!token) {
        reconnectTimer = setTimeout(() => void connect(), RECONNECT_DELAY_MS);
        return;
      }

      const socket = new WebSocket(SYNC_WS_BASE, [`auth-${token}`]);

      socket.onopen = () => {
        if (disposed) {
          socket.close();
          return;
        }
        authFailCount = 0;
        socketRef.current = socket;
        // Replay every held join; refused rooms stay out (room-registry.ts).
        // Paced in batches — see JOIN_REPLAY_BATCH.
        joinReplayQueue = rooms.takeReplay();
        if (joinReplayTimer !== null) clearTimeout(joinReplayTimer);
        drainJoinReplay(socket);
        dispatch('$sync/connected', undefined);
      };

      socket.onmessage = (event) => {
        let message: ServerMessage;
        try {
          message = JSON.parse(event.data as string) as ServerMessage;
        } catch {
          console.error('[sync-ws] dropped non-JSON frame');
          return;
        }
        if (
          message.type === 'room_joined' ||
          message.type === 'room_join_denied' ||
          message.type === 'removed_from_room'
        ) {
          handleRoomLifecycle(message);
        }

        const workItemId = (message.payload as { work_item_id?: unknown } | null)?.work_item_id;

        // Someone was added to a work item this window may hold refused
        // (its artifact was shared alone, say): the share may be ours.
        if (message.type === 'participant_added' && typeof workItemId === 'string') {
          rooms.retryRefused(`${WORK_ITEM_ROOM_PREFIX}${workItemId}`);
        }

        // Gap detection (room-seq-tracker.ts): only frames sent through
        // broadcastToRoom carry room_seq/epoch, so anything else — the
        // room-lifecycle frames above, chat_message_ack, notifications —
        // skips this untouched. A reported gap re-fires the EXISTING
        // '$sync/connected' signal every relevant consumer already reseeds
        // on, rather than inventing a resync channel every consumer would
        // have to learn. The frame itself is still dispatched normally below
        // either way — unlike the local turn-stream, room event types are
        // independently idempotent/self-healing (id-deduped messages,
        // version-guarded work item updates), so there is no reason to
        // withhold it while a consumer's reseed is in flight.
        if (
          typeof workItemId === 'string' &&
          typeof message.room_seq === 'number' &&
          typeof message.epoch === 'string'
        ) {
          const roomId = `${WORK_ITEM_ROOM_PREFIX}${workItemId}`;
          if (roomSeqTrackerRef.current.track(roomId, message.epoch, message.room_seq)) {
            scheduleReseedSignal();
          }
        }

        dispatch(message.type, message.payload);
        if (typeof workItemId === 'string') {
          dispatch(`${message.type}.${workItemId}`, message.payload);
        }
      };

      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        // Server-side membership died with the socket; the next onopen builds
        // a fresh replay queue from what is still held.
        if (joinReplayTimer !== null) {
          clearTimeout(joinReplayTimer);
          joinReplayTimer = null;
        }
        joinReplayQueue = [];
        // Server-side room membership died with the connection; held rooms
        // go back to joining so the next onopen replays their joins.
        rooms.markDisconnected();
        if (disposed) return;

        if (event.code === 1006) {
          authFailCount++;
          clearCachedToken();
        }
        const delay = authFailCount > 2 ? RECONNECT_DELAY_MS * 3 : RECONNECT_DELAY_MS;
        reconnectTimer = setTimeout(() => void connect(), delay);
      };

      socket.onerror = () => {
        socket.close();
      };
    }

    reconnectTimer = setTimeout(() => void connect(), INITIAL_DELAY_MS);

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      if (joinReplayTimer) clearTimeout(joinReplayTimer);
      if (reseedSignalTimer) clearTimeout(reseedSignalTimer);
      joinReplayQueue = [];
      const socket = socketRef.current;
      socketRef.current = null;
      if (socket && socket.readyState <= WebSocket.OPEN) socket.close();
    };
  }, [rooms]);

  return useMemo(
    () => ({
      sendEvent,
      subscribeEvent,
      acquireWorkItemRoom,
      acquireArtifactRoom,
      getWorkItemRoomStatus,
    }),
    [sendEvent, subscribeEvent, acquireWorkItemRoom, acquireArtifactRoom, getWorkItemRoomStatus]
  );
}

export function SyncSocketContextProvider({ children }: { children: ReactNode }) {
  const value = useSyncSocketService();
  return <SyncSocketContext.Provider value={value}>{children}</SyncSocketContext.Provider>;
}

export function useSyncSocketContext(): SyncSocketContextValue {
  const context = useContext(SyncSocketContext);
  if (!context) {
    throw new Error('useSyncSocketContext must be used within a SyncSocketContextProvider');
  }
  return context;
}
