import { randomUUID } from 'node:crypto';
import {
  turnStreamChannel,
  type StreamItem,
  type TurnStreamAction,
  type TurnStreamEvent,
} from '@shared/stream-items';
import { events } from '@main/lib/events';

const COALESCE_MS = 50;

// Keyed by work item, not session: the renderer holds one seq cursor per work
// item, so every session in the item shares one ordered sequence.
const sessionSequence = new Map<string, { epoch: string; seq: number }>();

export function resetSessionEpoch(workItemId: string): void {
  sessionSequence.set(workItemId, { epoch: randomUUID(), seq: 0 });
}

export function clearSessionEpoch(workItemId: string): void {
  sessionSequence.delete(workItemId);
}

function emitTurnEvent(workItemId: string, event: TurnStreamEvent): void {
  let tracker = sessionSequence.get(workItemId);
  if (!tracker) {
    tracker = { epoch: randomUUID(), seq: 0 };
    sessionSequence.set(workItemId, tracker);
  }
  tracker.seq++;
  events.emit(turnStreamChannel, { ...event, seq: tracker.seq, epoch: tracker.epoch }, workItemId);
}

/**
 * The live turn's item list and its outbound wire. Every mutation is coalesced
 * into a batched turn-stream event so a fast-streaming agent does not flood the
 * renderer; permission and error items bypass the coalescer because an
 * interactive card must render the instant it exists.
 */
export class TurnItemStream {
  private items: StreamItem[] = [];
  private turnId = randomUUID();
  private pendingActions: TurnStreamAction[] = [];
  private coalesceTimer: ReturnType<typeof setTimeout> | null = null;
  private maxLatencyTimer: ReturnType<typeof setTimeout> | null = null;
  private currentWorkItemId: string | null = null;
  private flushing = false;
  private sessionId: string | undefined;
  private errored = false;

  /** Stamped on every emitted event so the renderer can attribute turns to a session. */
  setSessionId(id: string): void {
    this.sessionId = id;
  }

  get turnIdentifier(): string {
    return this.turnId;
  }

  get itemCount(): number {
    return this.items.length;
  }

  /** Set by markErrored; cleared on startNextTurn. */
  get isErrored(): boolean {
    return this.errored;
  }

  /** Marks the in-flight turn as having hit an error item or an abnormal exit. */
  markErrored(): void {
    this.errored = true;
  }

  /** Live reference — callers mutate items in place, then call `update`. */
  listItems(): StreamItem[] {
    return this.items;
  }

  cloneItems(): StreamItem[] {
    return structuredClone(this.items);
  }

  lastItem(): StreamItem | undefined {
    return this.items[this.items.length - 1];
  }

  findItem<T extends StreamItem>(predicate: (item: StreamItem) => item is T): T | undefined {
    return this.items.find(predicate);
  }

  findLastItem<T extends StreamItem>(predicate: (item: StreamItem) => item is T): T | undefined {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const item = this.items[i];
      if (predicate(item)) return item;
    }
    return undefined;
  }

  add(workItemId: string, item: StreamItem): void {
    this.items.push(item);
    if (item.kind === 'permission' || item.kind === 'question' || item.kind === 'error') {
      this.flush();
      emitTurnEvent(workItemId, {
        workItemId,
        turnId: this.turnId,
        sessionId: this.sessionId,
        action: { type: 'item_added', item },
      });
      return;
    }
    this.currentWorkItemId = workItemId;
    this.pendingActions.push({ type: 'item_added', item });
    this.scheduleFlush();
  }

  update(workItemId: string, item: StreamItem): void {
    this.currentWorkItemId = workItemId;
    this.pendingActions.push({ type: 'item_updated', itemId: item.id, item });
    this.scheduleFlush();
  }

  /** A thinking block only spins while it is the agent's latest output. */
  finalizeThoughts(): void {
    for (const item of this.items) {
      if (item.kind === 'thinking' && item.status === 'loading') {
        item.status = 'ready';
      }
    }
  }

  emitTurnStarted(workItemId: string, agentName: string, timestamp: number): void {
    emitTurnEvent(workItemId, {
      workItemId,
      turnId: this.turnId,
      sessionId: this.sessionId,
      action: { type: 'turn_started', agentName, timestamp },
    });
  }

  emitTurnCompleted(workItemId: string, timestamp: number): void {
    emitTurnEvent(workItemId, {
      workItemId,
      turnId: this.turnId,
      sessionId: this.sessionId,
      action: { type: 'turn_completed', timestamp },
    });
  }

  startNextTurn(): void {
    this.items = [];
    this.turnId = randomUUID();
    this.errored = false;
  }

  flush(): void {
    if (this.flushing) return;
    this.flushing = true;

    try {
      if (this.coalesceTimer) {
        clearTimeout(this.coalesceTimer);
        this.coalesceTimer = null;
      }
      if (this.maxLatencyTimer) {
        clearTimeout(this.maxLatencyTimer);
        this.maxLatencyTimer = null;
      }
      if (this.pendingActions.length === 0) return;

      const actions = deduplicateActions(this.pendingActions);
      const workItemId = this.currentWorkItemId!;
      this.pendingActions = [];

      if (actions.length === 1) {
        emitTurnEvent(workItemId, {
          workItemId,
          turnId: this.turnId,
          sessionId: this.sessionId,
          action: actions[0],
        });
      } else {
        emitTurnEvent(workItemId, {
          workItemId,
          turnId: this.turnId,
          sessionId: this.sessionId,
          action: { type: 'items_batch', actions },
        });
      }
    } finally {
      this.flushing = false;
    }
  }

  private scheduleFlush(): void {
    if (this.coalesceTimer) clearTimeout(this.coalesceTimer);
    this.coalesceTimer = setTimeout(() => this.flush(), COALESCE_MS);
    if (!this.maxLatencyTimer) {
      this.maxLatencyTimer = setTimeout(() => this.flush(), COALESCE_MS * 3);
    }
  }
}

/** Only the newest state of a given item reaches the wire within one batch. */
function deduplicateActions(actions: TurnStreamAction[]): TurnStreamAction[] {
  const result: TurnStreamAction[] = [];
  const seenUpdates = new Map<string, number>();

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i];
    if (action.type === 'item_updated') {
      const prevIdx = seenUpdates.get(action.itemId);
      if (prevIdx !== undefined) {
        result[prevIdx] = action;
        continue;
      }
      seenUpdates.set(action.itemId, result.length);
    }
    result.push(action);
  }

  return result;
}
