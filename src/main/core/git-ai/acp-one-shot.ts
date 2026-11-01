import { spawn, type ChildProcess } from 'node:child_process';
import { Readable, Writable } from 'node:stream';
import type { ClientConnection, StopReason } from '@agentclientprotocol/sdk';
import packageJson from '@root/package.json';
import { getAgentDisplayName } from '@shared/agent-display-name';
import { getProvider } from '@shared/agent-providers';
import type { GitAiAgent } from '@shared/git-ai';
import {
  acpSetRequest,
  readAcpControls,
  type AcpControlsReply,
} from '@main/core/acp/acp-session-controls';
import { killAcpProcess } from '@main/core/acp/spawn-acp-process';
import { agentFailed, GitAiError } from './git-ai-errors';
import { GIT_AI_SYSTEM_PROMPT } from './git-ai-prompts';
import { withRunFolder, type OneShotRequest } from './one-shot-run';

/** The answer of one ACP prompt turn, or the typed failure it ended with. */
export function readAcpOneShotResult(args: {
  agent: GitAiAgent;
  stopReason: StopReason | null;
  agentText: string;
  /** The prompt request or the process failed. */
  error: string | null;
  stderr: string;
}): string {
  const { agent, stopReason, agentText, error, stderr } = args;
  const name = getAgentDisplayName(agent);
  if (error !== null) throw agentFailed(agent, error, agentText, stderr);
  if (stopReason === 'cancelled') throw new GitAiError({ type: 'canceled' });
  if (stopReason === 'refusal') {
    throw agentFailed(agent, `${name} refused to answer.`, agentText, stderr);
  }
  if (stopReason !== 'end_turn') {
    throw agentFailed(
      agent,
      `${name} stopped before finishing (${stopReason ?? 'no stop reason'}).`,
      agentText,
      stderr
    );
  }
  if (!agentText.trim()) throw agentFailed(agent, `${name} returned an empty answer.`, stderr);
  return agentText;
}

/** Whether the agent advertises `session/close` in `initialize`. */
export function acpCanCloseSession(capabilities: {
  sessionCapabilities?: { close?: unknown } | null;
}): boolean {
  return capabilities.sessionCapabilities?.close != null;
}

/** The ACP SDK, loaded on first use so it stays out of the startup module graph. */
const loadAcpSdk = () => import('@agentclientprotocol/sdk');

/** An ACP agent's process with a connection that grants nothing. */
export interface AcpOneShotConnection {
  connection: ClientConnection;
  child: ChildProcess;
  readStderr: () => string;
  /** Ends the process tree and resolves once it has exited. */
  stop: () => Promise<void>;
}

function waitForExit(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => child.once('exit', () => resolve()));
}

/**
 * Ends a one-shot's agent and resolves once it has exited. A child that already exited is not
 * killed by pid (devstation-l9k5, `killAcpProcess`).
 */
export async function stopAcpChild(child: ChildProcess): Promise<'tree' | 'signal' | 'exited'> {
  const exited = waitForExit(child);
  const how = killAcpProcess(child);
  await exited;
  return how;
}

/**
 * Spawns `agent`'s ACP bridge in `cwd` and connects with a client that offers
 * no file system and no terminal, refuses any such request, and denies every
 * permission request — so a turn can only answer in text.
 */
export async function connectAcpOneShot(
  agent: GitAiAgent,
  cwd: string
): Promise<AcpOneShotConnection> {
  const acpConfig = getProvider(agent)?.acpConfig;
  if (!acpConfig || acpConfig.usesNpx) throw new Error(`${agent} has no ACP bridge binary`);
  // Loaded before the spawn: nothing may await between the spawn and the
  // process listeners attached here and by the caller.
  const { client, ndJsonStream } = await loadAcpSdk();
  const child = spawn(acpConfig.bridge, acpConfig.acpArgs ?? [], {
    cwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    // The bridges are npm shims (`.cmd`) on Windows, which only a shell runs.
    shell: process.platform === 'win32',
  });
  let stderr = '';
  child.stderr!.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const refuse = (method: string) => () => {
    throw new Error(`Git AI runs without ${method}`);
  };
  const app = client({ name: 'Chord Git AI' })
    .onRequest('session/request_permission', ({ params }) => {
      const options = (params as { options?: Array<{ optionId: string; kind: string }> }).options;
      const reject = options?.find((option) => option.kind.startsWith('reject'));
      return {
        outcome: reject
          ? { outcome: 'selected' as const, optionId: reject.optionId }
          : { outcome: 'cancelled' as const },
      };
    })
    .onRequest('fs/read_text_file', refuse('file access'))
    .onRequest('fs/write_text_file', refuse('file access'))
    .onRequest('terminal/create', refuse('a terminal'));
  const stream = ndJsonStream(
    Writable.toWeb(child.stdin!) as WritableStream<Uint8Array>,
    Readable.toWeb(child.stdout!) as ReadableStream<Uint8Array>
  );
  const connection = app.connect(stream);
  return {
    connection,
    child,
    readStderr: () => stderr,
    stop: async () => {
      await stopAcpChild(child);
    },
  };
}

/** `initialize` then `session/new` in `cwd` with no MCP servers. */
export async function openAcpOneShotSession(acp: AcpOneShotConnection, cwd: string) {
  const { PROTOCOL_VERSION } = await loadAcpSdk();
  const initialized = await acp.connection.agent.request('initialize', {
    protocolVersion: PROTOCOL_VERSION,
    clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
    clientInfo: { name: 'chord', title: 'Chord', version: packageJson.version },
  });
  const session = await acp.connection.agent.buildSession({ cwd, mcpServers: [] }).start();
  return { session, canClose: acpCanCloseSession(initialized.agentCapabilities ?? {}) };
}

/**
 * One prompt on an ACP agent: a session in an empty temp folder, no MCP
 * servers, every permission denied, then `session/close` when the agent
 * advertises it. The agent may keep its own record of that temp session.
 */
export async function runAcpOneShot(agent: GitAiAgent, request: OneShotRequest): Promise<string> {
  const name = getAgentDisplayName(agent);
  return withRunFolder(async (cwd) => {
    const acp = await connectAcpOneShot(agent, cwd);
    let agentText = '';
    let spawnError: string | null = null;
    acp.child.once('error', (error) => {
      spawnError = error.message;
    });
    try {
      const { session, canClose } = await openAcpOneShotSession(acp, cwd);
      const reply = session.newSessionResponse as AcpControlsReply;
      const modelControl = readAcpControls(reply).model;
      if (request.model) {
        if (!modelControl) throw agentFailed(agent, `${name} does not let a session pick a model.`);
        const set = acpSetRequest(modelControl, request.model);
        await acp.connection.agent.request(set.method, {
          sessionId: session.sessionId,
          ...set.params,
        });
      }
      const cancel = () =>
        void acp.connection.agent.notify('session/cancel', { sessionId: session.sessionId });
      request.signal.addEventListener('abort', cancel, { once: true });
      if (request.signal.aborted) cancel();
      const done = session.prompt(`${GIT_AI_SYSTEM_PROMPT}\n\n${request.prompt}`).then(
        () => null,
        (error: unknown) => (error instanceof Error ? error.message : String(error))
      );
      const never = new Promise<never>(() => {});
      let stopReason: StopReason | null = null;
      let promptError: string | null = null;
      for (;;) {
        const next = await Promise.race([
          session.nextUpdate(),
          done.then((failure) => (failure === null ? never : failure)),
        ]);
        if (typeof next === 'string') {
          promptError = next;
          break;
        }
        if (next.kind === 'stop') {
          stopReason = next.stopReason;
          break;
        }
        const update = next.update;
        if (update.sessionUpdate === 'agent_message_chunk' && update.content.type === 'text') {
          agentText += update.content.text;
        }
      }
      request.signal.removeEventListener('abort', cancel);
      if (canClose)
        await acp.connection.agent.request('session/close', { sessionId: session.sessionId });
      session.dispose();
      return readAcpOneShotResult({
        agent,
        stopReason,
        agentText,
        error: promptError,
        stderr: acp.readStderr(),
      });
    } catch (error) {
      if (error instanceof GitAiError) throw error;
      if (request.signal.aborted) throw new GitAiError({ type: 'canceled' });
      const message = spawnError ?? (error instanceof Error ? error.message : String(error));
      throw agentFailed(agent, message, agentText, acp.readStderr());
    } finally {
      await acp.stop();
    }
  });
}
