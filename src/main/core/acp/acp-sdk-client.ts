import type { ChildProcess } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type {
  ClientConnection,
  McpServer,
  NewSessionResponse,
  PromptResponse,
} from '@agentclientprotocol/sdk';
import packageJson from '@root/package.json';
import type { AcpPermissionRequest, AcpSessionUpdate } from '@shared/acp-types';
import type { UsageInfo } from '@shared/events/agentOutputEvents';
import { describeAcpSessionSupport } from '@main/core/session-import/acp-history';
import { log } from '@main/lib/logger';
import { resolveAgentReportedPath } from '@main/utils/agent-reported-path';
import { mapAcpPromptUsage } from './acp-adapter';
import type { AcpControlsReply } from './acp-session-controls';
import { spawnAcpProcess, stopAcpProcess, type AcpProcess } from './spawn-acp-process';

/** The ACP SDK, loaded on first use so it stays out of the startup module graph. */
const loadAcpSdk = () => import('@agentclientprotocol/sdk');
type AcpSdk = Awaited<ReturnType<typeof loadAcpSdk>>;

export interface AcpSDKClientOptions {
  command: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  /**
   * MCP servers for `session/new`, chosen once the agent has said in
   * `initialize` whether it takes HTTP servers (stdio it must always take).
   */
  mcpServers?: (transport: { http: boolean }) => McpServer[];
  onSessionUpdate: (update: AcpSessionUpdate) => void;
  onPermissionRequest: (request: AcpPermissionRequest) => void;
  onFileWrite?: (filePath: string) => void;
  onError: (error: Error) => void;
  onExit: (code: number | null) => void;
}

export class AcpSDKClient {
  private process: ChildProcess | null = null;
  /** Settles once the agent and everything holding its stdio have exited (`spawnAcpProcess`). */
  private processClosed: Promise<void> | null = null;
  private agent: ClientConnection['agent'] | null = null;
  private sessionId = '';
  private closed = false;
  /**
   * True while `session/load` replays a continued session's history: that
   * history is already in the chat (it was imported), so the replay is not
   * handed to the bridge, which would show it again as a new turn.
   */
  private replaying = false;

  constructor(private options: AcpSDKClientOptions) {}

  /**
   * Spawns the agent and opens a session; `controls` is what the session can be
   * switched to. With `resumeSessionId` the agent's own session is continued —
   * `session/resume` when it advertises it, else `session/load` — instead of a
   * new one; an agent that can do neither is refused.
   *
   * The agent is running before the handshake, and a start that fails
   * registers no session, so no teardown would ever stop it: a failed start
   * abandons the agent (`abandon`) before it rejects.
   */
  async start(
    resumeSessionId?: string
  ): Promise<{ sessionId: string; controls: AcpControlsReply }> {
    const { command, args, cwd, env } = this.options;
    // Loaded before the spawn: nothing may await between the spawn and the
    // process listeners `openSession` attaches.
    const sdk = await loadAcpSdk();
    const { child, stream, closed } = await spawnAcpProcess({ command, args, cwd, env });
    this.process = child;
    this.processClosed = closed;
    try {
      return await this.openSession(sdk, child, stream, resumeSessionId);
    } catch (error) {
      await this.abandon();
      throw error;
    }
  }

  private async openSession(
    { client, PROTOCOL_VERSION }: AcpSdk,
    child: ChildProcess,
    stream: AcpProcess['stream'],
    resumeSessionId: string | undefined
  ): Promise<{ sessionId: string; controls: AcpControlsReply }> {
    const { cwd } = this.options;

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString().trim();
      if (text && !text.includes('notifications/initialized')) {
        log.error('AcpSDKClient: stderr', { data: text.slice(0, 500) });
      }
    });

    child.on('error', (err) => {
      log.error('AcpSDKClient: process error', { error: err.message });
      this.options.onError(err);
    });

    child.on('exit', (code) => {
      if (!this.closed) {
        this.closed = true;
        this.options.onExit(code);
      }
    });

    const app = client({ name: 'Chord' })
      .onRequest('session/request_permission', ({ params }) => {
        const options =
          ((params as Record<string, unknown>).options as Array<{
            optionId: string;
            name: string;
            kind: string;
          }>) ?? [];

        const autoOption =
          options.find((o) => o.kind === 'allow_always') ??
          options.find((o) => o.kind === 'allow_once') ??
          options[0];

        return {
          outcome: autoOption
            ? { outcome: 'selected' as const, optionId: autoOption.optionId }
            : { outcome: 'selected' as const, optionId: '' },
        };
      })
      // The ACP twin of the claude-sdk PreToolUse hook: here Chord is the one
      // that opens the file, so an agent that reports its workspace in MSYS
      // form (`/tmp/repo/plan.md` for a repo under `%TEMP%`) would have Chord
      // resolve the leading slash against the current drive and mirror the
      // whole tree into `C:\tmp\...`. Translate before touching the disk.
      .onRequest('fs/read_text_file', ({ params }) => {
        const p = params as Record<string, unknown>;
        const reported = (p.path ?? p.file_path ?? p.filePath) as string | undefined;
        const filePath = reported ? resolveAgentReportedPath(reported, cwd) : undefined;
        let content = '';
        if (filePath) {
          try {
            content = readFileSync(filePath, 'utf-8');
          } catch {
            /* file not found */
          }
        }
        return { content };
      })
      .onRequest('fs/write_text_file', ({ params }) => {
        const p = params as Record<string, unknown>;
        const reported = (p.path ?? p.file_path ?? p.filePath) as string | undefined;
        const filePath = reported ? resolveAgentReportedPath(reported, cwd) : undefined;
        const content = (p.content ?? '') as string;
        if (filePath) {
          try {
            mkdirSync(dirname(filePath), { recursive: true });
            writeFileSync(filePath, content, 'utf-8');
          } catch (e) {
            log.warn('AcpSDKClient: writeTextFile error', { error: String(e) });
          }
        }
        if (filePath && this.options.onFileWrite) {
          this.options.onFileWrite(filePath);
        }
        return {};
      })
      .onNotification('session/update', ({ params }) => {
        if (this.replaying) return;
        const notification = params as Record<string, unknown>;
        const update = (notification.update ?? notification) as AcpSessionUpdate;
        if (update?.sessionUpdate) {
          this.options.onSessionUpdate(update);
        }
      });

    const connection = app.connect(stream);
    this.agent = connection.agent;

    void connection.closed.then(() => {
      if (!this.closed) {
        this.closed = true;
        this.options.onExit(0);
      }
    });

    // ACP opens with `initialize`: it is where the agent says what it can do.
    // The client advertises no fs or terminal capability — the agent keeps
    // doing its own file IO, as it did before this handshake was sent.
    const initialized = await connection.agent.request('initialize', {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'chord', title: 'Chord', version: packageJson.version },
    });
    const http = initialized.agentCapabilities?.mcpCapabilities?.http === true;
    const request = {
      cwd,
      mcpServers: this.options.mcpServers?.({ http }) ?? [],
      _meta: { claudeCode: { options: { permissionMode: 'bypassPermissions' } } },
    };

    // The SDK types the replies as the current schema; agents may also send the
    // legacy `models` field, which `readAcpControls` reads.
    let reply: AcpControlsReply;
    if (resumeSessionId) {
      const method = describeAcpSessionSupport(initialized).continueWith;
      if (!method) {
        throw new Error(
          `This agent can't continue session ${resumeSessionId}: it offers neither session/resume nor session/load`
        );
      }
      this.replaying = method === 'session/load';
      try {
        reply = await connection.agent.request<AcpControlsReply>(method, {
          ...request,
          sessionId: resumeSessionId,
        });
      } finally {
        this.replaying = false;
      }
      this.sessionId = resumeSessionId;
    } else {
      const created = await connection.agent.request<NewSessionResponse>('session/new', request);
      reply = created as AcpControlsReply;
      this.sessionId = created.sessionId;
    }

    return {
      sessionId: this.sessionId,
      controls: { configOptions: reply.configOptions, models: reply.models, modes: reply.modes },
    };
  }

  /** A session-scoped JSON-RPC call (`session/set_config_option`, …); the reply is wire data. */
  async requestForSession(method: string, params: Record<string, string>): Promise<unknown> {
    if (!this.agent || !this.sessionId) throw new Error('ACP session not started');
    return this.agent.request(method, { sessionId: this.sessionId, ...params });
  }

  /**
   * Runs one turn; resolves with the turn's token usage, when the agent reports
   * it. The turn's updates reach `onSessionUpdate` before its reply: they are
   * notifications ahead of it on the same stream.
   */
  async sendPrompt(text: string): Promise<UsageInfo | null> {
    if (!this.agent || !this.sessionId) throw new Error('ACP session not started');
    const reply = await this.agent.request<PromptResponse>('session/prompt', {
      sessionId: this.sessionId,
      prompt: [{ type: 'text', text }],
    });
    return mapAcpPromptUsage(reply);
  }

  async respondToPermission(_requestId: string, _optionId: string): Promise<void> {
    // Permissions are auto-approved in the SDK client onRequest handler
  }

  async cancel(): Promise<void> {
    // The SDK handles cancellation through the session
  }

  /**
   * Stops the agent and resolves once it, and what it started in the lane,
   * are gone (`stopAcpProcess`); throws when it outlives that. A caller may
   * remove the lane's folder next (lane Delete), which fails on Windows while
   * a process still sits in it.
   */
  async stop(): Promise<void> {
    const child = this.process;
    const closed = this.processClosed;
    if (!child || !closed) return;
    this.process = null;
    this.processClosed = null;
    await stopAcpProcess(child, closed);
  }

  /**
   * Stops the agent of a launch that failed, and waits for it like `stop`.
   * The launch's rejection is the failure its caller handles, so `onExit` is
   * not called for this stop, and an agent that outlives it is logged rather
   * than thrown over that rejection.
   */
  async abandon(): Promise<void> {
    this.closed = true;
    const [stop] = await Promise.allSettled([this.stop()]);
    if (stop.status === 'rejected') {
      log.warn('AcpSDKClient: an agent whose launch failed outlived its stop', {
        error: String(stop.reason),
      });
    }
  }

  isAlive(): boolean {
    return this.process !== null && !this.closed;
  }
}
