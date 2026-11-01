/**
 * Two signed-in Chord accounts for the P6 sharing done-check
 * (scripts/e2e/artifact-sharing.mjs): each is a built app instance on its own
 * throw-away profile, seeded from a profile already signed in to that account,
 * plus a REST client and a real Hocuspocus client that act as that user.
 */
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';
import { launchSeededApp } from '../seeded-app.mjs';

const API_URL = requireEnv('VITE_CLOUD_API_URL');
const COLLAB_URL = requireEnv('VITE_COLLAB_WS_URL');

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (.env)`);
  return value;
}

export function apiUrl(path) {
  return `${API_URL.replace(/\/+$/, '')}${path}`;
}

export async function assertServerHealthy() {
  const res = await fetch(apiUrl('/health'));
  if (!res.ok) throw new Error(`Sync server at ${API_URL} is not healthy: ${res.status}`);
}

/** Anonymous request, e.g. a public link opened in a signed-out browser. */
export async function fetchSignedOut(path) {
  const res = await fetch(apiUrl(path));
  return { status: res.status, headers: res.headers, text: await res.text() };
}

/**
 * @param {{ seedProfile: string, label: string }} options
 */
/** `env` is layered over the app's own (e.g. an agent's home folder for one run). */
export async function launchAccount({ seedProfile, label, reopenProfile, env = {} }) {
  const instance = await launchSeededApp({
    source: 'built',
    seedProfile,
    profilePrefix: `chord-p6-${label}`,
    reopenProfile,
    env: { LOG_LEVEL: 'info', ...env },
  });
  const { session } = instance;
  const email = session.user.email;

  // Set before this instance closes, so cleanup can still act as this user.
  let frozenToken = null;
  let closed = false;
  /** `{ before }` steps whose result is the step to run after the app exits. */
  const closeSteps = [];
  async function token() {
    if (frozenToken) return frozenToken;
    if (closed) throw new Error(`${label} is closed and had no valid token`);
    const value = await instance.rpc('account.getAccessToken');
    if (typeof value !== 'string' || !value) throw new Error(`${label} has no access token`);
    return value;
  }

  /** REST as this user. Returns status + parsed JSON (or text when not JSON). */
  async function api(method, path, body) {
    const res = await fetch(apiUrl(path), {
      method,
      headers: {
        Authorization: `Bearer ${await token()}`,
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }
    return { status: res.status, body: json };
  }

  /** RPC into this instance's main process; throws on an err() result. */
  async function call(channel, ...args) {
    const res = await instance.rpc(channel, ...args);
    if (!res?.success) throw new Error(`${label} ${channel} failed: ${JSON.stringify(res)}`);
    return res.data;
  }

  return {
    label,
    email,
    userId: session.user.userId,
    instance,
    token,
    api,
    call,
    openDocument: (artifactId) => openDocument(token, artifactId),
    /**
     * Runs `before` while the app is still open and `after` once it has exited
     * (its processes gone, its files released), whenever this account closes,
     * mid-suite or at the end.
     */
    onClose: (step) => closeSteps.push(step),
    /**
     * Closes the app and deletes its profile, or keeps it for a
     * `reopenProfile` launch; REST keeps working on the last good token.
     */
    close: async ({ keepProfile = false } = {}) => {
      if (closed) return;
      closed = true;
      const last = await instance.rpc('account.getAccessToken');
      if (typeof last === 'string' && last) frozenToken = last;
      const afters = [];
      for (const step of closeSteps) afters.push(await step.before());
      await instance.close({ keepProfile });
      for (const after of afters) await after();
    },
  };
}

/**
 * A live Yjs connection to an artifact document as one user — the same
 * transport the editor uses. Resolves once synced, or with `denied` when the
 * server refuses authentication. `closed` flips when the server drops it.
 */
export function openDocument(token, artifactId, timeoutMs = 20_000) {
  const document = new Y.Doc();
  const socket = new HocuspocusProviderWebsocket({ url: COLLAB_URL, WebSocketPolyfill: WebSocket });
  const state = { denied: null, closed: false, readOnly: null };
  let settle;
  const ready = new Promise((resolve) => {
    settle = resolve;
  });
  const provider = new HocuspocusProvider({
    websocketProvider: socket,
    name: `artifact-${artifactId}`,
    document,
    token,
    onAuthenticated: ({ scope }) => {
      state.readOnly = scope === 'readonly';
    },
    onAuthenticationFailed: ({ reason }) => {
      state.denied = reason ?? 'denied';
      settle();
    },
    onSynced: () => settle(),
    onClose: () => {
      state.closed = true;
    },
  });
  provider.attach();
  const timer = setTimeout(() => settle(), timeoutMs);

  const fragment = () => document.getXmlFragment('default');
  return ready.then(() => {
    clearTimeout(timer);
    return {
      state,
      synced: provider.isSynced,
      readText: () => fragment().toString(),
      appendParagraph: (text) => {
        const paragraph = new Y.XmlElement('paragraph');
        paragraph.insert(0, [new Y.XmlText(text)]);
        fragment().insert(fragment().length, [paragraph]);
      },
      destroy: () => {
        provider.destroy();
        socket.destroy();
      },
    };
  });
}

export async function waitFor(predicate, timeoutMs, what) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timed out after ${timeoutMs / 1000}s waiting for ${what}`);
}
