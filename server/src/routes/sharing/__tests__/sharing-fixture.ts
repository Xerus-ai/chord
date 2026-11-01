import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { ServerEvent } from '@chord/protocol';
import express from 'express';
import { vi } from 'vitest';
import type { Database } from '../../../db/client.js';
import type { ServerSchema } from '../../../db/server-schema.js';
import { createTestDatabase } from '../../../db/test-database.js';
import type { AuthenticatedWebSocket, ConnectionManager } from '../../../ws/connection-manager.js';

/**
 * Real-DB fixture for the sharing route tests: the production route wiring
 * (mountJsonBodyParsers, mountResourceRoutes) on an express app whose auth
 * step is replaced by a "who is calling" switch, a real ConnectionManager, and
 * helpers that create users, teams, work items and artifacts directly in the
 * database.
 */

export const SYNC_SERVER_URL = 'https://chord.test';

export interface SharingFixture {
  db: Database;
  s: ServerSchema;
  base: string;
  connectionManager: ConnectionManager;
  start(): Promise<void>;
  stop(): Promise<void>;
  makeUser(): Promise<{ id: string; email: string }>;
  makeTeam(ownerId: string, memberIds: string[], seatLimit?: number): Promise<string>;
  makeArtifact(workItemId: string): Promise<string>;
  as(userId: string | null): Caller;
  /** No signed-in user: public web routes answer, everything else is 401 as in production. */
  anonymous(): Caller;
  /**
   * Joins a socket to `roomId` on the real ConnectionManager and returns the
   * events broadcast to that room from then on, parsed off the wire frames.
   */
  watchRoom(roomId: string): ServerEvent[];
  /**
   * Connects a socket as `userId` (so the user counts as online) and returns
   * the events broadcast to that user from then on.
   */
  watchUser(userId: string): ServerEvent[];
}

/**
 * The surface ConnectionManager writes to (connection-manager.test.ts): it
 * records the frames the real broadcast path puts on the wire.
 */
function recordingSocket(userId: string, received: ServerEvent[]): AuthenticatedWebSocket {
  return {
    user: {
      userId,
      orgId: null,
      role: null,
      email: '',
      permissions: [],
      sessionId: `watcher_${userId}`,
    },
    isAlive: true,
    rooms: new Set<string>(),
    lastSeen: new Date(),
    clientType: 'renderer',
    deviceId: null,
    readyState: 1,
    OPEN: 1,
    bufferedAmount: 0,
    send: (raw: string) => received.push(JSON.parse(raw) as ServerEvent),
    on: () => {},
    terminate: () => {},
  } as unknown as AuthenticatedWebSocket;
}

export interface Caller {
  get(path: string): Promise<CallResult>;
  post(path: string, body?: unknown): Promise<CallResult>;
  put(path: string, body?: unknown): Promise<CallResult>;
  patch(path: string, body: unknown): Promise<CallResult>;
  del(path: string): Promise<CallResult>;
}

export interface CallResult {
  status: number;
  // Response JSON; shape varies per route and is asserted field by field.
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any
  /** Raw body, for HTML routes. */
  text: string;
  headers: Headers;
}

export function createSharingFixture(): SharingFixture {
  const testDb = createTestDatabase();
  vi.stubEnv('DATABASE_URL', testDb.url);
  vi.stubEnv('WORKOS_CLIENT_ID', 'client_test');
  vi.stubEnv('DEV_MODE', '');
  vi.stubEnv('SHARE_LINK_SECRET', 'test-share-link-secret-0123456789abcdef');
  vi.stubEnv('SYNC_SERVER_URL', SYNC_SERVER_URL);

  const emails = new Map<string, string>();
  let callerId: string | null = null;
  let server: ReturnType<ReturnType<typeof express>['listen']> | null = null;

  const fixture = {
    base: '',
    async start() {
      await testDb.start();
      fixture.db = (await import('../../../db/client.js')).db;
      fixture.s = (await import('../../../db/server-schema.js')).serverSchema;
      const { mountJsonBodyParsers } = await import('../../../middleware/json-body-parsers.js');
      const { mountResourceRoutes } = await import('../../mount-resource-routes.js');
      const { mountPublicWebRoutes } = await import('../../../web/mount-public-web-routes.js');
      const { ConnectionManager } = await import('../../../ws/connection-manager.js');

      const app = express();
      mountJsonBodyParsers(app);
      mountPublicWebRoutes(app);
      app.use((req, res, next) => {
        if (!callerId) {
          res.status(401).json({ error: 'Unauthorized' });
          return;
        }
        if (callerId) {
          (req as unknown as { user: unknown }).user = {
            userId: callerId,
            orgId: null,
            role: null,
            email: emails.get(callerId) ?? '',
            permissions: [],
            sessionId: `session_${callerId}`,
          };
        }
        next();
      });
      fixture.connectionManager = new ConnectionManager();
      mountResourceRoutes(app, fixture.connectionManager);

      server = app.listen(0);
      await new Promise((resolve) => server!.once('listening', resolve));
      fixture.base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    },
    async stop() {
      if (server) await new Promise((resolve) => server!.close(resolve));
      await testDb.stop();
    },
    async makeUser() {
      const id = randomUUID();
      const email = `${id.slice(0, 8)}@test.example.com`;
      await fixture.db.insert(fixture.s.users).values({ id, email, name: id.slice(0, 4) });
      emails.set(id, email);
      return { id, email };
    },
    async makeTeam(ownerId: string, memberIds: string[], seatLimit = 5) {
      const id = randomUUID();
      await fixture.db
        .insert(fixture.s.organizations)
        .values({ id, name: 'team', seat_limit: seatLimit });
      await fixture.db
        .insert(fixture.s.orgMemberships)
        .values({ org_id: id, user_id: ownerId, role: 'owner' });
      for (const userId of memberIds) {
        await fixture.db.insert(fixture.s.orgMemberships).values({ org_id: id, user_id: userId });
      }
      return id;
    },
    async makeArtifact(workItemId: string) {
      const id = randomUUID();
      await fixture.db
        .insert(fixture.s.artifacts)
        .values({ id, work_item_id: workItemId, name: 'plan.md' });
      return id;
    },
    anonymous(): Caller {
      return fixture.as(null);
    },
    watchRoom(roomId: string): ServerEvent[] {
      const received: ServerEvent[] = [];
      fixture.connectionManager.joinRoom(
        recordingSocket(`watcher_${randomUUID()}`, received),
        roomId
      );
      return received;
    },
    watchUser(userId: string): ServerEvent[] {
      const received: ServerEvent[] = [];
      fixture.connectionManager.addConnection(recordingSocket(userId, received));
      return received;
    },
    as(userId: string | null): Caller {
      async function call(method: string, path: string, body?: unknown): Promise<CallResult> {
        callerId = userId;
        const res = await fetch(`${fixture.base}${path}`, {
          method,
          headers: body === undefined ? {} : { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        const text = await res.text();
        const isJson = (res.headers.get('content-type') ?? '').includes('application/json');
        return {
          status: res.status,
          body: isJson && text ? JSON.parse(text) : null,
          text,
          headers: res.headers,
        };
      }
      return {
        get: (path) => call('GET', path),
        post: (path, body) => call('POST', path, body ?? {}),
        put: (path, body) => call('PUT', path, body ?? {}),
        patch: (path, body) => call('PATCH', path, body),
        del: (path) => call('DELETE', path),
      };
    },
  } as SharingFixture;

  return fixture;
}
