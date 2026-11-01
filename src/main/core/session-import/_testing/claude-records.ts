import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Writes Claude Code transcripts in the record shapes Claude Code 2.1.28x
 * writes them (field sets from the S6 census of 63 real transcripts,
 * `chord-lane-checks/probe-s6/claude-jsonl-census.out.txt`, and the shapes
 * probe `probe-arx7/shapes.out.txt`):
 *
 * - one line per assistant content block, every block of one API message
 *   sharing `message.id`, each block's record parented on the previous one;
 * - a tool result is its own `user` record, parented on the record of the
 *   `tool_use` it answers (`sourceToolAssistantUUID`), so parallel calls fork
 *   the parent chain (probe-arx7/parallel-shape.mjs);
 * - compaction writes `system/compact_boundary` with `parentUuid: null` and
 *   `logicalParentUuid` naming the last record before it, then an
 *   `isCompactSummary` user record;
 * - bookkeeping lines (`mode`, `ai-title`, `last-prompt`, `attachment`,
 *   `file-history-snapshot`, `system/turn_duration`, …) interleave.
 *
 * Lives under `_testing/` so vitest never collects it as a suite.
 */
export interface TranscriptOptions {
  sessionId: string;
  cwd: string;
  /** ms epoch of the first record; each chained record is one second later. */
  startAt: number;
}

type Block = Record<string, unknown>;

export class ClaudeTranscriptWriter {
  readonly lines: Record<string, unknown>[] = [];
  /** uuid the next chained record is parented on. */
  private last: string | null = null;
  private clock: number;

  constructor(private readonly opts: TranscriptOptions) {
    this.clock = opts.startAt;
  }

  /** The time the next chained record will carry. */
  get nextAt(): number {
    return this.clock;
  }

  get lastUuid(): string | null {
    return this.last;
  }

  private base(type: string): Record<string, unknown> {
    const at = this.clock;
    this.clock += 1000;
    return {
      parentUuid: this.last,
      isSidechain: false,
      type,
      uuid: randomUUID(),
      timestamp: new Date(at).toISOString(),
      userType: 'external',
      entrypoint: 'cli',
      cwd: this.opts.cwd,
      sessionId: this.opts.sessionId,
      version: '2.1.283',
      gitBranch: 'main',
    };
  }

  private chain(record: Record<string, unknown>): string {
    this.lines.push(record);
    this.last = record.uuid as string;
    return this.last;
  }

  /** A line outside the parent chain (`mode`, `ai-title`, `file-history-snapshot`, …). */
  meta(record: Record<string, unknown>): void {
    this.lines.push({ ...record, sessionId: this.opts.sessionId });
  }

  attachment(): string {
    return this.chain({
      ...this.base('attachment'),
      attachment: {
        type: 'hook_success',
        hookName: 'SessionStart:startup',
        hookEvent: 'SessionStart',
        content: '',
        stdout: '{}\r\n',
        stderr: '',
        exitCode: 0,
      },
    });
  }

  /** A prompt the user typed: a string, or text/image blocks. */
  prompt(content: string | Block[], extra: Record<string, unknown> = {}): string {
    return this.chain({
      ...this.base('user'),
      promptId: randomUUID(),
      message: { role: 'user', content },
      permissionMode: 'default',
      origin: { kind: 'human' },
      promptSource: 'typed',
      turnOrigin: 'human',
      ...extra,
    });
  }

  /** A `user` record Claude Code writes itself (`isMeta`, command wrappers, notifications). */
  userRecord(content: string, extra: Record<string, unknown> = {}): string {
    return this.chain({ ...this.base('user'), message: { role: 'user', content }, ...extra });
  }

  /** One API message: one record per block, all sharing `message.id`. Returns each block's uuid. */
  assistant(blocks: Block[]): string[] {
    const messageId = `msg_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
    return blocks.map((block, index) =>
      this.chain({
        ...this.base('assistant'),
        message: {
          model: 'claude-opus-5-5',
          id: messageId,
          type: 'message',
          role: 'assistant',
          content: [block],
          stop_reason: blocks.some((b) => b.type === 'tool_use') ? 'tool_use' : 'end_turn',
          stop_sequence: null,
          usage: { input_tokens: 2, output_tokens: 40 },
        },
        requestId: `req_${messageId.slice(4)}`,
        apiBlockIndex: index,
      })
    );
  }

  /** A tool result, parented on the `tool_use` record it answers. */
  toolResult(
    toolUseRecord: string,
    toolUseId: string,
    content: string | Block[],
    opts: { isError?: boolean; toolUseResult?: unknown } = {}
  ): string {
    const record = {
      ...this.base('user'),
      parentUuid: toolUseRecord,
      promptId: randomUUID(),
      message: {
        role: 'user',
        content: [
          { tool_use_id: toolUseId, type: 'tool_result', content, is_error: opts.isError === true },
        ],
      },
      toolUseResult: opts.toolUseResult ?? (typeof content === 'string' ? content : {}),
      sourceToolAssistantUUID: toolUseRecord,
    };
    return this.chain(record);
  }

  system(subtype: string, extra: Record<string, unknown> = {}): string {
    return this.chain({ ...this.base('system'), subtype, level: 'info', isMeta: false, ...extra });
  }

  /** `/compact`: the boundary breaks the parent chain; its logical parent continues it. */
  compact(summary: string): void {
    const boundary = {
      ...this.base('system'),
      parentUuid: null,
      logicalParentUuid: this.last,
      subtype: 'compact_boundary',
      content: 'Conversation compacted',
      level: 'info',
      compactMetadata: { trigger: 'manual', preTokens: 239594, postTokens: 14910 },
    };
    this.chain(boundary);
    this.chain({
      ...this.base('user'),
      message: {
        role: 'user',
        content: `This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.\n\nSummary:\n${summary}`,
      },
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    });
  }

  /** Continue the chain from an earlier record — a rewind, or a parallel call's result. */
  continueFrom(uuid: string): void {
    this.last = uuid;
  }

  toJsonl(): string {
    return `${this.lines.map((line) => JSON.stringify(line)).join('\n')}\n`;
  }
}

export const thinking = (text: string): Block => ({
  type: 'thinking',
  thinking: text,
  signature: 'CAQSkwkKEAgSGAI4AUIIdGhpbmtpbmcSDLc9at',
});
export const text = (value: string): Block => ({ type: 'text', text: value });
export const toolUse = (id: string, name: string, input: Record<string, unknown>): Block => ({
  type: 'tool_use',
  id,
  name,
  input,
  caller: { type: 'direct' },
});
/** A pasted screenshot as Claude Code stores it: inline base64. */
export const image = (base64: string): Block => ({
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data: base64 },
});

/** The project directory Claude Code writes `cwd`'s transcripts to, under a config dir. */
export function writeTranscript(
  projectDir: string,
  sessionId: string,
  writer: ClaudeTranscriptWriter
): string {
  mkdirSync(projectDir, { recursive: true });
  const file = join(projectDir, `${sessionId}.jsonl`);
  writeFileSync(file, writer.toJsonl());
  return file;
}

/** A subagent transcript and its `.meta.json`, as `<session>/subagents/agent-<id>.*`. */
export function writeSubagent(
  projectDir: string,
  sessionId: string,
  agentId: string,
  meta: { toolUseId: string; description: string; agentType: string },
  writer: ClaudeTranscriptWriter
): void {
  const dir = join(projectDir, sessionId, 'subagents');
  mkdirSync(dir, { recursive: true });
  const lines = writer.lines.map((line) =>
    'uuid' in line ? { ...line, isSidechain: true, agentId } : line
  );
  writeFileSync(
    join(dir, `agent-${agentId}.jsonl`),
    `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`
  );
  writeFileSync(
    join(dir, `agent-${agentId}.meta.json`),
    JSON.stringify({ ...meta, spawnDepth: 1, requestShape: 'background', model: 'fable' })
  );
}
