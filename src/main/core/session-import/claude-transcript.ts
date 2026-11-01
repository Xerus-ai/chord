import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ToolContentBlock } from '@shared/stream-items';
import { inferToolKind } from '@main/core/claude-sdk/sdk-message-translator';
import {
  contentBlocks,
  readJsonLines,
  selectConversationRecords,
  type ClaudeRecord,
} from './claude-transcript-chain';
import { ImportTranscriptBuilder, type ImportedMessage } from './transcript-builder';

/** What an image in the history becomes: Chord's chat holds no images. */
export const IMAGE_MARKER = '[image]';

type Block = Record<string, unknown>;

/** Records Claude Code writes as `user` that the user never typed. */
const NOT_TYPED = [
  '<local-command-stdout>',
  '<local-command-caveat>',
  '<bash-stdout>',
  '<task-notification>',
];

/** A user record's text as the user typed it, or null for one Claude Code wrote itself. */
function typedPrompt(text: string): string | null {
  const command = /<command-name>([\s\S]*?)<\/command-name>/.exec(text);
  if (command) {
    const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(text)?.[1]?.trim();
    return args ? `${command[1].trim()} ${args}` : command[1].trim();
  }
  const bash = /^\s*<bash-input>([\s\S]*?)<\/bash-input>/.exec(text);
  if (bash) return `! ${bash[1].trim()}`;
  const start = text.trimStart();
  if (NOT_TYPED.some((tag) => start.startsWith(tag))) return null;
  return text;
}

function promptFromBlocks(blocks: Block[]): string {
  return blocks
    .flatMap((block) => {
      if (block.type === 'text' && typeof block.text === 'string') return [block.text];
      if (block.type === 'image') return [IMAGE_MARKER];
      return [];
    })
    .join('\n\n');
}

function resultBlocks(content: unknown): ToolContentBlock[] {
  if (typeof content === 'string') return content ? [{ type: 'text', text: content }] : [];
  if (!Array.isArray(content)) return [];
  return (content as Block[]).flatMap((item): ToolContentBlock[] => {
    if (item.type === 'text' && typeof item.text === 'string')
      return [{ type: 'text', text: item.text }];
    if (item.type === 'image') return [{ type: 'text', text: IMAGE_MARKER }];
    if (item.type === 'tool_reference' && typeof item.tool_name === 'string') {
      return [{ type: 'text', text: item.tool_name }];
    }
    return [];
  });
}

/**
 * Background subagents' reports by the `tool_use` id that launched them:
 * `<session>/subagents/agent-*.meta.json` names it, and the report is the text
 * of the agent's last message that had any.
 */
class SubagentReports {
  private byToolUse: Map<string, string> | null = null;

  constructor(private readonly dir: string) {}

  async reportFor(toolUseId: string): Promise<string | null> {
    const transcript = this.index().get(toolUseId);
    if (!transcript || !existsSync(transcript)) return null;
    let messageId: string | undefined;
    let texts: string[] = [];
    for await (const record of readJsonLines(transcript)) {
      if (record.type !== 'assistant') continue;
      for (const block of contentBlocks(record)) {
        if (block.type !== 'text' || typeof block.text !== 'string') continue;
        if (record.message?.id !== messageId) {
          messageId = record.message?.id;
          texts = [];
        }
        texts.push(block.text);
      }
    }
    return texts.length > 0 ? texts.join('') : null;
  }

  private index(): Map<string, string> {
    if (this.byToolUse) return this.byToolUse;
    this.byToolUse = new Map();
    if (!existsSync(this.dir)) return this.byToolUse;
    for (const name of readdirSync(this.dir)) {
      if (!name.endsWith('.meta.json')) continue;
      const meta = JSON.parse(readFileSync(join(this.dir, name), 'utf8')) as { toolUseId?: string };
      if (meta.toolUseId) {
        this.byToolUse.set(meta.toolUseId, join(this.dir, name.replace(/\.meta\.json$/, '.jsonl')));
      }
    }
    return this.byToolUse;
  }
}

function isAsyncLaunch(record: ClaudeRecord): boolean {
  const result = record.toolUseResult as { status?: unknown } | undefined;
  return typeof result === 'object' && result !== null && result.status === 'async_launched';
}

/**
 * A Claude Code transcript as chat rows: the conversation Claude would resume
 * (`selectConversationRecords`), compaction included, folded the way the live
 * chat folds SDK output. Images become `[image]`; a background subagent shows
 * as its Agent call carrying the report from its own transcript, the way the
 * live chat shows subagents (their inner calls are not drawn).
 */
export async function readClaudeTranscript(file: string, cwd: string): Promise<ImportedMessage[]> {
  const selected = await selectConversationRecords(file);
  const subagents = new SubagentReports(join(dirname(file), basename(file, '.jsonl'), 'subagents'));
  const builder = new ImportTranscriptBuilder(cwd);

  for await (const record of readJsonLines(file)) {
    if (typeof record.uuid !== 'string' || !selected.has(record.uuid)) continue;
    const at = Date.parse(record.timestamp ?? '');
    if (Number.isNaN(at)) throw new Error(`${file}: record ${record.uuid} has no timestamp`);

    if (record.type === 'assistant') {
      for (const block of contentBlocks(record)) {
        if (block.type === 'thinking') builder.thinking(String(block.thinking ?? ''), at);
        if (block.type === 'text' && typeof block.text === 'string') {
          builder.openTextBlock();
          builder.appendText(block.text, at);
        }
        if (block.type === 'tool_use') {
          const name = String(block.name);
          builder.toolCall(
            {
              callId: String(block.id),
              name,
              kind: inferToolKind(name),
              rawInput: block.input as Record<string, unknown> | undefined,
            },
            at
          );
        }
      }
      continue;
    }

    if (record.isMeta || record.isCompactSummary) continue;
    const content = record.message?.content;
    if (typeof content === 'string') {
      const prompt = typedPrompt(content);
      if (prompt !== null) builder.prompt(prompt, at);
      continue;
    }
    const blocks = contentBlocks(record);
    const results = blocks.filter((block) => block.type === 'tool_result');
    if (results.length === 0) {
      builder.prompt(promptFromBlocks(blocks), at);
      continue;
    }
    for (const result of results) {
      const callId = String(result.tool_use_id);
      const report = isAsyncLaunch(record) ? await subagents.reportFor(callId) : null;
      builder.toolUpdate(
        callId,
        {
          status: result.is_error === true ? 'failed' : 'completed',
          contentBlocks:
            report !== null ? [{ type: 'text', text: report }] : resultBlocks(result.content),
        },
        at
      );
    }
  }
  return builder.finish();
}
