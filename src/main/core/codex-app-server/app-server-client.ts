import { spawn, type ChildProcess } from 'node:child_process';
import { createInterface } from 'node:readline';
import packageJson from '@root/package.json';
import {
  resolveCodexHomeKey,
  runCodexHomeTransition,
  trackCodexShutdown,
  waitForCodexShutdowns,
} from './codex-shutdown-registry';
import type { InitializeParams } from './protocol/InitializeParams';

/** A JSON-RPC error reply from the app-server. */
export class CodexAppServerError extends Error {
  constructor(
    readonly method: string,
    readonly code: number,
    message: string
  ) {
    super(`codex app-server ${method} failed (${code}): ${message}`);
    this.name = 'CodexAppServerError';
  }
}

export interface CodexAppServerHandlers {
  onNotification: (method: string, params: unknown) => void;
  /** A request the server makes of the client (approvals); answer with `respond`. */
  onServerRequest: (id: number | string, method: string, params: unknown) => void;
  onStderr?: (text: string) => void;
  /** The server broke the protocol; the connection is closed after this. */
  onError: (error: Error) => void;
  onExit: (code: number | null) => void;
}

interface Pending {
  method: string;
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** How much of the server's stderr its exit error carries. */
const STDERR_TAIL_CHARS = 2000;

/** How long a closed server may take to exit before a new start gives up on it. */
const SHUTDOWN_WAIT_MS = 15_000;

/**
 * `codex app-server` over stdio: newline-delimited JSON-RPC (without the
 * `jsonrpc` field). Opts into the experimental API, which carries the plan
 * collaboration mode.
 */
export class CodexAppServerClient {
  private nextId = 1;
  private readonly pending = new Map<number, Pending>();
  private exited = false;
  private closing = false;
  /** A server that dies says why on stderr; its exit error carries the tail. */
  private stderrTail = '';

  private constructor(
    private readonly child: ChildProcess,
    private readonly handlers: CodexAppServerHandlers,
    private readonly codexHome: string
  ) {
    createInterface({ input: child.stdout! }).on('line', (line) => {
      try {
        this.handleLine(line);
      } catch (e) {
        const error = e instanceof Error ? e : new Error(String(e));
        this.failPending(error);
        handlers.onError(error);
        this.close();
      }
    });
    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString();
      this.stderrTail = (this.stderrTail + text).slice(-STDERR_TAIL_CHARS);
      handlers.onStderr?.(text);
    });
    child.on('exit', (code) => this.handleExit(code));
    child.on('error', (e) => {
      // A spawn that failed (no such binary) never ran and never emits 'exit':
      // there is no server to wait for when it is closed.
      if (child.pid === undefined) this.exited = true;
      this.failPending(e);
    });
  }

  /**
   * Spawns the server and completes the `initialize` handshake, in line
   * behind any other start or shutdown on the same CODEX_HOME
   * (`runCodexHomeTransition`).
   */
  static async start(opts: {
    command: string;
    cwd: string;
    env?: NodeJS.ProcessEnv;
    /** Codex feature flags to switch on for this server (`--enable <name>`). */
    enableFeatures?: readonly string[];
    handlers: CodexAppServerHandlers;
  }): Promise<CodexAppServerClient> {
    // An npm-installed codex is a .cmd shim, which Windows only runs via a shell.
    const viaShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(opts.command);
    const args = ['app-server', ...(opts.enableFeatures ?? []).flatMap((f) => ['--enable', f])];
    const env = opts.env ?? process.env;
    const codexHome = resolveCodexHomeKey(env);
    // Before joining the line: the closes registered now are queued ahead of
    // this start. From inside the line it would also wait for closes queued
    // behind it, which cannot run until it is done.
    await waitForCodexShutdowns(codexHome, SHUTDOWN_WAIT_MS);
    const client = await runCodexHomeTransition(codexHome, async () => {
      const child = spawn(viaShell ? `"${opts.command}"` : opts.command, args, {
        cwd: opts.cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        shell: viaShell,
      });
      const started = new CodexAppServerClient(child, opts.handlers, codexHome);
      const params: InitializeParams = {
        clientInfo: { name: 'chord', title: 'Chord', version: packageJson.version },
        capabilities: { experimentalApi: true, requestAttestation: false },
      };
      try {
        await started.request('initialize', params);
      } catch (e) {
        started.close();
        throw e;
      }
      return started;
    });
    client.send({ method: 'initialized' });
    return client;
  }

  /**
   * Runs `work` against a short-lived server that is closed afterwards — for
   * one-off reads (the model list, the account's limits) outside a session.
   */
  static async runOnce<T>(
    command: string,
    cwd: string,
    work: (client: CodexAppServerClient) => Promise<T>
  ): Promise<T> {
    let protocolError: Error | null = null;
    const client = await CodexAppServerClient.start({
      command,
      cwd,
      handlers: {
        onNotification: () => {},
        onServerRequest: (id, method) => {
          throw new Error(`codex app-server sent an unexpected ${method} request (${id})`);
        },
        onError: (e) => {
          protocolError = e;
        },
        onExit: () => {},
      },
    });
    try {
      const result = await work(client);
      if (protocolError) throw protocolError;
      return result;
    } finally {
      client.close();
    }
  }

  request<T>(method: string, params?: unknown): Promise<T> {
    if (this.exited) return Promise.reject(new Error(`codex app-server exited before ${method}`));
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { method, resolve: resolve as (r: unknown) => void, reject });
      this.send({ method, id, params });
    });
  }

  respond(id: number | string, result: unknown): void {
    this.send({ id, result });
  }

  respondError(id: number | string, code: number, message: string): void {
    this.send({ id, error: { code, message } });
  }

  isAlive(): boolean {
    return !this.exited;
  }

  /**
   * Ends stdin, on which the server shuts down cleanly. Never kill it: on
   * Windows a killed server leaves its CODEX_HOME state unopenable while it
   * goes down. Until it exits it is registered as closing, and `start` for the
   * same CODEX_HOME waits for it. The shutdown waits its turn behind starts on
   * the home (`runCodexHomeTransition`); one that outlasts SHUTDOWN_WAIT_MS
   * leaves the line, and the next start fails naming it.
   */
  close(): void {
    if (this.exited || this.closing) return;
    this.closing = true;
    const exited = new Promise<void>((resolve) => this.child.once('exit', () => resolve()));
    trackCodexShutdown(this.codexHome, exited);
    void runCodexHomeTransition(this.codexHome, async () => {
      this.child.stdin?.end();
      let timer: NodeJS.Timeout | undefined;
      await Promise.race([
        exited,
        new Promise<void>((resolve) => {
          timer = setTimeout(resolve, SHUTDOWN_WAIT_MS);
        }),
      ]);
      clearTimeout(timer);
    });
  }

  private send(message: Record<string, unknown>): void {
    this.child.stdin!.write(`${JSON.stringify(message)}\n`);
  }

  private handleLine(line: string): void {
    if (!line.trim()) return;
    const message: unknown = JSON.parse(line);
    if (!isRecord(message)) throw new Error(`codex app-server sent a non-object: ${line}`);
    const { id, method } = message;
    if (typeof method === 'string') {
      if (typeof id === 'number' || typeof id === 'string') {
        this.handlers.onServerRequest(id, method, message.params);
      } else {
        this.handlers.onNotification(method, message.params);
      }
      return;
    }
    if (typeof id !== 'number') throw new Error(`codex app-server reply without id: ${line}`);
    const pending = this.pending.get(id);
    if (!pending) return;
    this.pending.delete(id);
    if (isRecord(message.error)) {
      const { code, message: text } = message.error;
      pending.reject(
        new CodexAppServerError(pending.method, Number(code), String(text ?? 'unknown error'))
      );
    } else {
      pending.resolve(message.result);
    }
  }

  private handleExit(code: number | null): void {
    if (this.exited) return;
    this.exited = true;
    const stderr = this.stderrTail.trim();
    this.failPending(
      new Error(`codex app-server exited (code ${code})${stderr ? `: ${stderr}` : ''}`)
    );
    this.handlers.onExit(code);
  }

  private failPending(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
