import { randomUUID } from 'node:crypto';
import type {
  StreamItem,
  ToolCallItem,
  ToolCallStatus,
  ToolContentBlock,
  ToolFileLocation,
} from '@shared/stream-items';
import { collectChangedFiles } from '@main/core/chat-messages/collect-changed-files';
import type { AgentPathEnvironment } from '@main/utils/agent-reported-path';

/**
 * One row of an imported conversation, before it is written: a prompt as the
 * user's text row, or a reply as an `agent_turn` whose items have the shapes
 * the live path persists (`persist-agent-turn.ts`). Times are ms epoch.
 */
export type ImportedMessage =
  | { kind: 'human'; content: string; createdAt: number }
  | { kind: 'agent_turn'; items: StreamItem[]; startedAt: number; completedAt: number };

export interface ImportedToolCall {
  callId: string;
  name: string;
  kind: string;
  status?: ToolCallStatus;
  rawInput?: Record<string, unknown>;
  locations?: ToolFileLocation[];
  contentBlocks?: ToolContentBlock[];
}

export interface ImportedToolUpdate {
  status?: ToolCallStatus;
  rawInput?: Record<string, unknown>;
  contentBlocks?: ToolContentBlock[];
}

interface OpenTurn {
  items: StreamItem[];
  startedAt: number;
  completedAt: number;
}

/**
 * Folds a provider's history into chat rows the way the live bridge folds a
 * running turn (`append-turn-text.ts`, `track-tool-calls.ts`): text deltas
 * extend the current paragraph and a new block opens one, consecutive tool
 * calls share a card, and each turn ends with the files its edits changed.
 * Every provider's importer drives this one fold.
 */
export class ImportTranscriptBuilder {
  private readonly messages: ImportedMessage[] = [];
  /** Calls by id across every turn: a result can land after the next prompt. */
  private readonly tools = new Map<string, ToolCallItem>();
  private turn: OpenTurn | null = null;
  private blockOpened = false;

  /**
   * `cwd` is the lane: edit tools' reported paths are resolved against it.
   * `environment` is the platform the session was recorded on; it defaults
   * to this host, and a replay recorded elsewhere names its own.
   */
  constructor(
    private readonly cwd: string,
    private readonly environment?: AgentPathEnvironment
  ) {}

  prompt(content: string, at: number): void {
    this.closeTurn();
    this.messages.push({ kind: 'human', content, createdAt: at });
  }

  thinking(text: string, at: number): void {
    const last = this.turn?.items.at(-1);
    if (last?.kind === 'thinking') {
      last.text += text;
      this.openTurn(at);
      return;
    }
    if (!text.trim()) return;
    this.openTurn(at).items.push({
      kind: 'thinking',
      id: randomUUID(),
      text,
      status: 'ready',
      startedAt: at,
    });
  }

  openTextBlock(): void {
    this.blockOpened = true;
  }

  appendText(text: string, at: number): void {
    if (!text) return;
    const turn = this.openTurn(at);
    const last = turn.items.at(-1);
    const target = last?.kind === 'text' ? last : undefined;
    const opensParagraph = this.blockOpened && target !== undefined && !/\n\s*$/.test(target.text);
    this.blockOpened = false;
    if (target) {
      target.text += opensParagraph ? `\n\n${text}` : text;
    } else {
      turn.items.push({ kind: 'text', id: randomUUID(), text });
    }
  }

  toolCall(call: ImportedToolCall, at: number): void {
    if (this.tools.has(call.callId)) {
      this.toolUpdate(call.callId, call, at);
      return;
    }
    const turn = this.openTurn(at);
    const tool: ToolCallItem = {
      callId: call.callId,
      name: call.name,
      status: call.status ?? 'in_progress',
      kind: call.kind,
      ...(call.rawInput ? { rawInput: call.rawInput } : {}),
      ...(call.locations && call.locations.length > 0 ? { locations: call.locations } : {}),
      ...(call.contentBlocks && call.contentBlocks.length > 0
        ? { contentBlocks: call.contentBlocks }
        : {}),
    };
    this.tools.set(call.callId, tool);
    const last = turn.items.at(-1);
    if (last?.kind === 'tool_group') last.tools.push(tool);
    else turn.items.push({ kind: 'tool_group', id: randomUUID(), tools: [tool] });
  }

  toolUpdate(callId: string, update: ImportedToolUpdate, at: number): void {
    const tool = this.tools.get(callId);
    if (!tool) throw new Error(`A result for tool call ${callId}, which the history never made`);
    if (update.status) tool.status = update.status;
    if (update.rawInput && Object.keys(update.rawInput).length > 0) tool.rawInput = update.rawInput;
    if (update.contentBlocks && update.contentBlocks.length > 0) {
      tool.contentBlocks = update.contentBlocks;
    }
    if (this.turn) this.turn.completedAt = Math.max(this.turn.completedAt, at);
  }

  error(message: string, at: number): void {
    this.openTurn(at).items.push({ kind: 'error', id: randomUUID(), message });
  }

  /** Closes the open reply at the time the provider says it ended. */
  endTurn(at: number): void {
    if (this.turn) this.turn.completedAt = at;
    this.closeTurn();
  }

  finish(): ImportedMessage[] {
    this.closeTurn();
    // A call the history never answered was cut off; it did not finish.
    for (const tool of this.tools.values()) {
      if (tool.status === 'in_progress' || tool.status === 'pending') tool.status = 'failed';
    }
    return this.messages;
  }

  private openTurn(at: number): OpenTurn {
    if (!this.turn) {
      this.turn = { items: [], startedAt: at, completedAt: at };
    } else {
      this.turn.completedAt = Math.max(this.turn.completedAt, at);
    }
    return this.turn;
  }

  private closeTurn(): void {
    const turn = this.turn;
    this.turn = null;
    this.blockOpened = false;
    if (!turn) return;
    const files = collectChangedFiles(turn.items, this.cwd, this.environment);
    if (files.length > 0) turn.items.push({ kind: 'file_changes', id: randomUUID(), files });
    this.messages.push({ kind: 'agent_turn', ...turn });
  }
}
