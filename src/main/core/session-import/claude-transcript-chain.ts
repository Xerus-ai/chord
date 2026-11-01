import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';

/** A transcript line, as far as the importer reads it. */
export interface ClaudeRecord {
  type?: string;
  subtype?: string;
  uuid?: string;
  parentUuid?: string | null;
  logicalParentUuid?: string | null;
  isSidechain?: boolean;
  isMeta?: boolean;
  isCompactSummary?: boolean;
  timestamp?: string;
  message?: { id?: string; content?: unknown };
  toolUseResult?: unknown;
}

type Block = Record<string, unknown>;

export function contentBlocks(record: ClaudeRecord): Block[] {
  const content = record.message?.content;
  return Array.isArray(content) ? (content as Block[]) : [];
}

/** Every line of a JSONL file, parsed, streamed; a line that is not JSON stops the read, named. */
export async function* readJsonLines(file: string): AsyncGenerator<ClaudeRecord> {
  const lines = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  let number = 0;
  for await (const line of lines) {
    number++;
    if (!line.trim()) continue;
    let record: unknown;
    try {
      record = JSON.parse(line);
    } catch (error) {
      lines.close();
      throw new Error(`${file} line ${number} is not JSON: ${(error as Error).message}`);
    }
    if (typeof record === 'object' && record !== null) yield record as ClaudeRecord;
  }
}

const CHAINED_TYPES = new Set(['user', 'assistant', 'system', 'attachment']);

interface IndexedRecord {
  parent: string | null;
  type: string;
  messageId?: string;
  toolUseIds?: string[];
  answers?: string[];
}

/**
 * The records of the conversation Claude Code would resume, by uuid. One
 * streaming pass indexes the parent links only; the bodies are read again by
 * the caller, so a 20 MB transcript is never held.
 *
 * The conversation is the parent chain from the newest user/assistant record,
 * jumping a `compact_boundary` to its `logicalParentUuid` so the history from
 * before a compaction stays. Two things fork that chain without leaving the
 * conversation, both measured on real transcripts (probe-arx7
 * `chain-vs-linear.mjs`: 2258 results of on-chain calls were off it): a
 * parallel tool use writes its later `tool_use` blocks as siblings sharing the
 * on-chain block's `message.id`, and each result is parented on its own
 * `tool_use`. What remains off the chain is a branch the user rewound away from.
 */
export async function selectConversationRecords(file: string): Promise<Set<string>> {
  const index = new Map<string, IndexedRecord>();
  let leaf: string | null = null;
  for await (const record of readJsonLines(file)) {
    if (
      typeof record.uuid !== 'string' ||
      record.isSidechain ||
      !CHAINED_TYPES.has(record.type ?? '')
    ) {
      continue;
    }
    const entry: IndexedRecord = {
      parent:
        record.subtype === 'compact_boundary'
          ? (record.logicalParentUuid ?? null)
          : (record.parentUuid ?? null),
      type: record.type as string,
    };
    if (record.type === 'assistant') {
      entry.messageId = record.message?.id;
      entry.toolUseIds = contentBlocks(record)
        .filter((block) => block.type === 'tool_use')
        .map((block) => block.id as string);
    }
    if (record.type === 'user') {
      entry.answers = contentBlocks(record)
        .filter((block) => block.type === 'tool_result')
        .map((block) => block.tool_use_id as string);
    }
    index.set(record.uuid, entry);
    if (record.type === 'user' || record.type === 'assistant') leaf = record.uuid;
  }

  const chain = new Set<string>();
  for (let uuid = leaf; uuid !== null && !chain.has(uuid); uuid = index.get(uuid)?.parent ?? null) {
    if (!index.has(uuid)) break;
    chain.add(uuid);
  }

  const chainMessageIds = new Set<string>();
  for (const uuid of chain) {
    const messageId = index.get(uuid)?.messageId;
    if (messageId) chainMessageIds.add(messageId);
  }
  const selected = new Set<string>();
  const calls = new Set<string>();
  for (const [uuid, entry] of index) {
    const onChain = chain.has(uuid);
    const sibling = entry.messageId !== undefined && chainMessageIds.has(entry.messageId);
    if (entry.type === 'assistant' && (onChain || sibling)) {
      selected.add(uuid);
      for (const id of entry.toolUseIds ?? []) calls.add(id);
    } else if (entry.type === 'user' && onChain) {
      selected.add(uuid);
    }
  }
  for (const [uuid, entry] of index) {
    if (entry.type === 'user' && entry.answers?.some((id) => calls.has(id))) selected.add(uuid);
  }
  return selected;
}
