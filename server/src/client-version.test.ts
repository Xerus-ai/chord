import { createServer, type Server } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import {
  CHORD_VERSION_HEADER,
  CHORD_VERSION_PARAM,
  compareVersions,
  MIN_DESKTOP_VERSION,
} from '@chord/protocol';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import WebSocket from 'ws';
import * as Y from 'yjs';

/**
 * The server enforces the minimum desktop version (devstation-mg6u.13): the
 * signed-in API, the sync socket and the collab socket refuse a client that
 * names no version or one below MIN_DESKTOP_VERSION, before any token work,
 * while the routes browsers and services call stay open. Real app, real ports.
 * The bugs these catch: an old or unversioned client still reaching the API
 * after a protocol break, and a gate mounted so early it locks out /health
 * (the handshake itself) or sign-in.
 */
vi.stubEnv('DATABASE_URL', '');
vi.stubEnv('DEV_MODE', '');
vi.stubEnv('WORKOS_CLIENT_ID', 'client_version_test');
const { createApp } = await import('./server');
const { ConnectionManager } = await import('./ws/connection-manager');
const { createWebSocketServer } = await import('./ws/create-websocket-server');
const { createHocuspocusServer } = await import('./hocuspocus');

const BELOW = '0.0.1';
let server: Server;
let base: string;
let wsBase: string;

beforeAll(async () => {
  expect(compareVersions(BELOW, MIN_DESKTOP_VERSION)).toBeLessThan(0);
  const manager = new ConnectionManager();
  server = createServer(createApp(manager));
  createWebSocketServer(server, manager);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  wsBase = `ws://127.0.0.1:${port}`;
});
afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function get(path: string, version?: string) {
  return fetch(`${base}${path}`, {
    headers: version === undefined ? {} : { [CHORD_VERSION_HEADER]: version },
  });
}

describe('the signed-in API', () => {
  it('refuses a request that names no version, an unreadable one or one below the minimum', async () => {
    for (const version of [undefined, 'garbage', BELOW]) {
      const res = await get('/me', version);
      expect(res.status, String(version)).toBe(426);
      expect(await res.json()).toEqual({
        error: 'update_required',
        min_desktop_version: MIN_DESKTOP_VERSION,
      });
    }
  });

  it('lets a client at the minimum through to auth', async () => {
    const res = await get('/me', MIN_DESKTOP_VERSION);
    expect(res.status).toBe(401);
  });
});

describe('the routes browsers and services call', () => {
  it('answer without a version: /health, the sign-in poll, the public web pages', async () => {
    expect((await get('/health')).status).toBe(200);
    expect((await get('/auth/poll?state=s')).status).toBe(200);
    expect((await get('/p/no-such-token')).status).not.toBe(426);
  });
});

/** The HTTP status the server answered an upgrade with. */
function upgradeStatus(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, ['auth-not-a-real-token']);
    socket.on('unexpected-response', (_req, res) => {
      resolve(res.statusCode ?? 0);
      socket.terminate();
    });
    socket.on('open', () => reject(new Error(`${url} upgraded`)));
    socket.on('error', () => {});
  });
}

describe('the sync socket at /ws', () => {
  it('refuses an upgrade with no version or one below the minimum, before auth', async () => {
    expect(await upgradeStatus(`${wsBase}/ws`)).toBe(426);
    expect(await upgradeStatus(`${wsBase}/ws?${CHORD_VERSION_PARAM}=${BELOW}`)).toBe(426);
  });

  it('runs auth for an upgrade at the minimum', async () => {
    expect(await upgradeStatus(`${wsBase}/ws?${CHORD_VERSION_PARAM}=${MIN_DESKTOP_VERSION}`)).toBe(
      401
    );
  });
});

async function freePort(): Promise<number> {
  const probe = createTcpServer();
  await new Promise<void>((resolve) => probe.listen(0, '127.0.0.1', resolve));
  const { port } = probe.address() as AddressInfo;
  await new Promise<void>((resolve) => probe.close(() => resolve()));
  return port;
}

/** Connects to the collab server and returns why authentication failed. */
function collabRefusal(url: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = new HocuspocusProviderWebsocket({ url, WebSocketPolyfill: WebSocket });
    const provider = new HocuspocusProvider({
      websocketProvider: socket,
      name: 'artifact-version-test',
      document: new Y.Doc(),
      token: 'not-a-real-token',
      onAuthenticationFailed: ({ reason }) => {
        provider.destroy();
        socket.destroy();
        resolve(reason);
      },
    });
    provider.attach();
  });
}

describe('the collab socket', () => {
  it('rejects a connection with no version as update_required; at the minimum the token is what fails', async () => {
    const port = await freePort();
    const collab = createHocuspocusServer(port);
    await collab.listen();
    try {
      const url = `ws://127.0.0.1:${port}`;
      expect(await collabRefusal(url)).toMatch(/update_required/);
      expect(await collabRefusal(`${url}?${CHORD_VERSION_PARAM}=${BELOW}`)).toMatch(
        /update_required/
      );
      expect(
        await collabRefusal(`${url}?${CHORD_VERSION_PARAM}=${MIN_DESKTOP_VERSION}`)
      ).not.toMatch(/update_required/);
    } finally {
      await collab.destroy();
    }
  });
});
