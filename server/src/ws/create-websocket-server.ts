import type { Server } from 'node:http';
import { ClientEventSchema, type ClientEvent } from '@chord/protocol';
import { WebSocketServer } from 'ws';
import { authenticateWebSocket, DEV_MODE } from '../middleware/auth.js';
import { createWsRateLimiter } from '../middleware/rate-limit.js';
import { authorizeRoomJoin } from './authorize.js';
import {
  toPublicRoomUser,
  type AuthenticatedWebSocket,
  type ConnectionManager,
} from './connection-manager.js';
import {
  handleChatMessage,
  handlePresenceUpdate,
  handleTypingIndicator,
} from './event-handlers.js';

/**
 * The sync socket at /ws: authenticate the upgrade, rate-limit each
 * connection, and route each client event (split from server.ts).
 */

export function createWebSocketServer(server: Server, connectionManager: ConnectionManager) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });

  server.on('upgrade', (req, socket, head) => {
    // The raw TCP socket is ours until wss.handleUpgrade hands it to a
    // WebSocket. A client reset in that window (e.g. mid auth check) emits
    // 'error' here — unhandled, it kills the whole process.
    socket.on('error', (err) => {
      console.error('[ws] upgrade socket error:', err.message);
      socket.destroy();
    });

    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);

    if (url.pathname !== '/ws') {
      socket.destroy();
      return;
    }

    // Token extraction priority: Sec-WebSocket-Protocol `auth-<token>`
    // (preferred — never logged by proxies), then legacy query-string
    // fallback for existing clients during rollout, then Authorization header.
    const protocols = req.headers['sec-websocket-protocol'];
    const authProtocol = (typeof protocols === 'string' ? protocols.split(',') : (protocols ?? []))
      .map((p) => p.trim())
      .find((p) => p.startsWith('auth-'));
    const token =
      (authProtocol ? authProtocol.slice('auth-'.length) : null) ??
      url.searchParams.get('token') ??
      req.headers.authorization?.split(' ')[1];

    if (!token && !DEV_MODE) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // ?device_id= marks the Electron MAIN process's command-channel socket
    // (client_type 'device'): it gets commands_available doorbells and its
    // own liveness signal, and stays out of the renderer presence system —
    // see connection-manager.ts. Absent = a normal renderer socket.
    const deviceId = url.searchParams.get('device_id');

    authenticateWebSocket(token ?? '')
      .then((claims) => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          const authedWs = ws as AuthenticatedWebSocket;
          authedWs.user = claims;
          authedWs.clientType = deviceId ? 'device' : 'renderer';
          authedWs.deviceId = deviceId;
          wss.emit('connection', authedWs, req);
        });
      })
      .catch((err) => {
        console.error('[ws] auth failed:', err.message);
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
      });
  });

  wss.on('connection', (ws: AuthenticatedWebSocket) => {
    connectionManager.addConnection(ws);

    // One bucket per connection, never shared — an abusive socket only ever
    // exhausts its own budget, not another's.
    const wsRateLimiter = createWsRateLimiter();

    ws.on('message', (data) => {
      const raw = data.toString();

      // Budget every inbound message regardless of validity — garbage
      // bytes must still cost budget, or an attacker gets unlimited free
      // messages just by sending invalid JSON.
      const rateLimitResult = wsRateLimiter.consume(Buffer.byteLength(raw, 'utf8'));
      if (rateLimitResult === 'terminate') {
        console.warn(`[ws] sustained rate limit abuse, closing connection (${ws.user.userId})`);
        ws.send(JSON.stringify({ type: 'error', payload: 'Rate limit exceeded' }));
        ws.close(1008, 'rate limit exceeded');
        return;
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        ws.send(JSON.stringify({ type: 'error', payload: 'Invalid JSON' }));
        return;
      }

      const result = ClientEventSchema.safeParse(parsed);
      if (!result.success) {
        ws.send(
          JSON.stringify({
            type: 'error',
            payload: `Invalid event: ${result.error.issues[0]?.message ?? 'unknown'}`,
          })
        );
        return;
      }

      handleWsEvent(ws, result.data, connectionManager);
    });

    ws.on('close', () => {
      connectionManager.handleDisconnect(ws);
    });

    ws.on('error', (err) => {
      console.error(`[ws] error (${ws.user.userId}):`, err.message);
    });
  });

  return wss;
}

function handleWsEvent(
  ws: AuthenticatedWebSocket,
  event: ClientEvent,
  manager: ConnectionManager
): void {
  switch (event.type) {
    case 'join_room': {
      const { roomId } = event.payload;
      authorizeRoomJoin(ws, roomId)
        .then((allowed) => {
          if (!allowed) {
            ws.send(
              JSON.stringify({
                type: 'room_join_denied',
                payload: { roomId, reason: 'access_denied' },
              })
            );
            return;
          }
          manager.joinRoom(ws, roomId);
          ws.send(
            JSON.stringify({
              type: 'room_joined',
              payload: {
                roomId,
                members: manager.getRoomMembers(roomId),
              },
            })
          );
          // Device sockets join silently — transport for chat ingestion,
          // not presence (getRoomMembers filters them for the same reason).
          if (ws.clientType !== 'device') {
            manager.broadcastToRoom(
              roomId,
              { type: 'member_joined', payload: { roomId, user: toPublicRoomUser(ws.user) } },
              ws
            );
          }
        })
        .catch((err) => {
          console.error('[ws] join_room failed:', err.message);
          ws.send(
            JSON.stringify({ type: 'room_join_denied', payload: { roomId, reason: 'error' } })
          );
        });
      break;
    }
    case 'leave_room': {
      const { roomId } = event.payload;
      manager.leaveRoom(ws, roomId);
      // Mirrors join: a device's membership was never announced, so its
      // departure must not clear the user's renderer-driven viewer chips.
      // announceMemberLeft additionally holds the frame back while ANOTHER
      // window of the same user is still in the room — peers key presence by
      // user_id, not by socket.
      if (ws.clientType !== 'device') {
        manager.announceMemberLeft(ws.user.userId, roomId);
      }
      break;
    }
    case 'room_message': {
      const { roomId, ...rest } = event.payload;
      // Relaying into a room requires being in it (joining ran the access check).
      if (!ws.rooms.has(roomId)) {
        ws.send(JSON.stringify({ type: 'error', payload: 'Access denied: room_message' }));
        break;
      }
      manager.broadcastToRoom(
        roomId,
        { type: 'room_message', payload: { ...rest, from: ws.user.userId } },
        ws
      );
      break;
    }
    case 'chat_message':
      handleChatMessage(ws, event, manager).catch((err) => {
        console.error('[ws] chat_message failed:', err.message);
        ws.send(JSON.stringify({ type: 'error', payload: 'Failed to send message' }));
      });
      break;
    case 'presence_update':
      handlePresenceUpdate(ws, event, manager).catch((err) => {
        console.error('[ws] presence_update failed:', err.message);
        ws.send(JSON.stringify({ type: 'error', payload: 'Failed to update presence' }));
      });
      break;
    case 'typing_indicator':
      handleTypingIndicator(ws, event, manager).catch((err) => {
        console.error('[ws] typing_indicator failed:', err.message);
        ws.send(JSON.stringify({ type: 'error', payload: 'Failed to send typing indicator' }));
      });
      break;
  }
}
