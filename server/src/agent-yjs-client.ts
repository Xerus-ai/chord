import { createHash } from 'node:crypto';
import { HocuspocusProvider, HocuspocusProviderWebsocket } from '@hocuspocus/provider';
import WebSocket from 'ws';
import * as Y from 'yjs';

const AGENT_CURSOR_COLOR = '#f59e0b';
const AGENT_NAME = 'AI Agent';
const SYNC_TIMEOUT_MS = 15_000;
const FLUSH_TIMEOUT_MS = 15_000;
const IDLE_DISCONNECT_MS = 60_000;
const IDLE_SWEEP_INTERVAL_MS = 30_000;

interface AgentYjsClientOptions {
  serverUrl: string;
  documentName: string;
  token: string;
  agentName?: string;
  agentColor?: string;
}

export class AgentYjsClient {
  readonly ydoc: Y.Doc;
  private provider: HocuspocusProvider;
  private websocketProvider: HocuspocusProviderWebsocket;

  constructor(options: AgentYjsClientOptions) {
    const agentName = options.agentName ?? AGENT_NAME;
    const agentColor = options.agentColor ?? AGENT_CURSOR_COLOR;
    this.ydoc = new Y.Doc();

    this.websocketProvider = new HocuspocusProviderWebsocket({
      url: options.serverUrl,
      WebSocketPolyfill: WebSocket as unknown as typeof globalThis.WebSocket,
    });

    this.provider = new HocuspocusProvider({
      websocketProvider: this.websocketProvider,
      name: options.documentName,
      document: this.ydoc,
      token: options.token,
    });

    this.provider.setAwarenessField('user', {
      name: agentName,
      color: agentColor,
      isAgent: true,
    });

    // With an explicit websocketProvider the provider does not manage the
    // socket and never auto-attaches — without this call no auth or sync
    // message is ever sent and every waitForSync() hangs.
    this.provider.attach();
  }

  waitForSync(timeoutMs = SYNC_TIMEOUT_MS): Promise<void> {
    if (this.provider.isSynced) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.provider.off('synced', onSynced);
        this.provider.off('authenticationFailed', onAuthFailed);
        this.provider.off('destroy', onDestroy);
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Yjs sync timed out after ${timeoutMs}ms`));
      }, timeoutMs);
      const onSynced = ({ state }: { state: boolean }) => {
        if (state) {
          cleanup();
          resolve();
        }
      };
      const onAuthFailed = ({ reason }: { reason: string }) => {
        cleanup();
        reject(new Error(`Yjs authentication failed: ${reason}`));
      };
      // The provider emits 'destroy' before it strips its own listeners, so
      // without this handler a disconnect mid-wait would leave this promise
      // dangling until timeoutMs instead of failing fast.
      const onDestroy = () => {
        cleanup();
        reject(new Error('Yjs provider was destroyed while waiting for sync'));
      };
      this.provider.on('synced', onSynced);
      this.provider.on('authenticationFailed', onAuthFailed);
      this.provider.on('destroy', onDestroy);
    });
  }

  /**
   * Resolves once the server has acknowledged every locally queued update
   * (provider.unsyncedChanges drains to zero) — the real flush signal, not a
   * fixed sleep.
   */
  waitForFlush(timeoutMs = FLUSH_TIMEOUT_MS): Promise<void> {
    if (this.provider.unsyncedChanges === 0) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const cleanup = () => {
        this.provider.off('unsyncedChanges', onUnsyncedChanges);
        this.provider.off('destroy', onDestroy);
        clearTimeout(timer);
      };
      const timer = setTimeout(() => {
        const pending = this.provider.unsyncedChanges;
        cleanup();
        reject(
          new Error(`Yjs flush timed out after ${timeoutMs}ms with ${pending} unsynced changes`)
        );
      }, timeoutMs);
      const onUnsyncedChanges = ({ number }: { number: number }) => {
        if (number === 0) {
          cleanup();
          resolve();
        }
      };
      // Same rationale as waitForSync: a destroy mid-flush must reject
      // immediately rather than dangling until timeoutMs.
      const onDestroy = () => {
        cleanup();
        reject(new Error('Yjs provider was destroyed while waiting for flush'));
      };
      this.provider.on('unsyncedChanges', onUnsyncedChanges);
      this.provider.on('destroy', onDestroy);
    });
  }

  applyEdit(operations: AgentEditOperation[]): void {
    this.ydoc.transact(() => {
      for (const op of operations) {
        switch (op.type) {
          case 'insert_text': {
            const text = this.ydoc.getText(op.target ?? 'default');
            text.insert(op.index ?? 0, op.value ?? '');
            break;
          }
          case 'delete_text': {
            const text = this.ydoc.getText(op.target ?? 'default');
            text.delete(op.index ?? 0, op.length ?? 0);
            break;
          }
          case 'replace_text': {
            const text = this.ydoc.getText(op.target ?? 'default');
            text.delete(0, text.length);
            text.insert(0, op.value ?? '');
            break;
          }
          case 'insert_xml': {
            const fragment = this.ydoc.getXmlFragment(op.target ?? 'default');
            const el = new Y.XmlElement(op.tag ?? 'paragraph');
            if (op.value) {
              el.insert(0, [new Y.XmlText(op.value)]);
            }
            fragment.insert(op.index ?? fragment.length, [el]);
            break;
          }
          case 'set_map': {
            const map = this.ydoc.getMap(op.target ?? 'default');
            map.set(op.key!, op.value);
            break;
          }
        }
      }
    });
  }

  disconnect(): void {
    this.provider.destroy();
    this.websocketProvider.destroy();
  }
}

export interface AgentEditOperation {
  type: 'insert_text' | 'delete_text' | 'replace_text' | 'insert_xml' | 'set_map';
  target?: string;
  index?: number;
  length?: number;
  value?: string;
  key?: string;
  tag?: string;
}

// One live connection per (document, caller) reused across edit batches —
// keeps the agent's awareness presence stable instead of flickering on every
// batch, and drops the connect/sync cost from the request path. Idle
// connections are disconnected by the sweeper.
//
// Invariant: a pooled entry is disconnected only once it has been removed
// from clientPool (draining === true) AND its inFlight count has reached 0.
// Concurrent calls sharing an entry each hold a lease (inFlight++/--), so a
// slow caller can never have its client torn down under it by a sibling call
// (final/error) or by the idle sweeper.
interface PooledClient {
  client: AgentYjsClient;
  lastUsedAt: number;
  inFlight: number;
  draining: boolean;
}

const clientPool = new Map<string, PooledClient>();
let idleSweeper: NodeJS.Timeout | null = null;

function poolKey(documentName: string, token: string): string {
  const tokenHash = createHash('sha256').update(token).digest('hex').slice(0, 16);
  return `${documentName}:${tokenHash}`;
}

function ensureIdleSweeper(): void {
  if (idleSweeper) return;
  idleSweeper = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of clientPool) {
      if (now - entry.lastUsedAt >= IDLE_DISCONNECT_MS) {
        clientPool.delete(key);
        entry.draining = true;
        // Never tear down a client a concurrent call is still leasing — the
        // caller that eventually drops inFlight to 0 disconnects it instead.
        if (entry.inFlight === 0) {
          entry.client.disconnect();
        }
      }
    }
    if (clientPool.size === 0 && idleSweeper) {
      clearInterval(idleSweeper);
      idleSweeper = null;
    }
  }, IDLE_SWEEP_INTERVAL_MS);
  idleSweeper.unref();
}

/**
 * Applies one batch of agent operations and waits until the sync server has
 * acknowledged them. Returns the document state as this client holds it
 * then — the synced server document plus the batch — which is what an agent
 * milestone version snapshots (routes/agent-edits.ts).
 */
export async function applyAgentEdit(
  artifactId: string,
  operations: AgentEditOperation[],
  options: { serverUrl: string; token: string; final?: boolean }
): Promise<Uint8Array> {
  const documentName = `artifact-${artifactId}`;
  const key = poolKey(documentName, options.token);

  // Acquire: reuse the pooled entry unless it's absent or already draining —
  // a draining entry may be mid-disconnect and must never be handed to a new
  // call, which instead gets its own fresh connection under the same key.
  let entry = clientPool.get(key);
  if (!entry || entry.draining) {
    entry = {
      client: new AgentYjsClient({
        serverUrl: options.serverUrl,
        documentName,
        token: options.token,
      }),
      lastUsedAt: Date.now(),
      inFlight: 0,
      draining: false,
    };
    clientPool.set(key, entry);
    ensureIdleSweeper();
  }
  entry.lastUsedAt = Date.now();
  entry.inFlight += 1;

  try {
    await entry.client.waitForSync();
    entry.client.applyEdit(operations);
    await entry.client.waitForFlush();
    const flushedState = Y.encodeStateAsUpdate(entry.client.ydoc);
    entry.lastUsedAt = Date.now();

    // The caller marked this the task's last batch: drain the entry so no
    // new call can be handed this client, then disconnect below once every
    // in-flight lease (including this one) has been released.
    if (options.final && clientPool.get(key) === entry) {
      clientPool.delete(key);
      entry.draining = true;
    }
    return flushedState;
  } catch (err) {
    // A client that failed to sync or flush must not be reused — remove it
    // from the pool so the next batch starts from a fresh connection. Actual
    // teardown still waits for every in-flight lease to release below.
    if (clientPool.get(key) === entry) {
      clientPool.delete(key);
    }
    entry.draining = true;
    throw err;
  } finally {
    entry.inFlight -= 1;
    if (entry.draining && entry.inFlight === 0) {
      entry.client.disconnect();
    }
  }
}
