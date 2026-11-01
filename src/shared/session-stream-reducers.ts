import type { AgentTurn, StreamItem, TurnStreamAction } from './stream-items';

const FLUSH_DELAY_MS = 48;

// ---------------------------------------------------------------------------
// Session timeline cursor — tracks sequenced events for gap detection
// ---------------------------------------------------------------------------

export interface TimelineCursor {
  epoch: string;
  startSeq: number;
  endSeq: number;
}

export type SeqDecision = 'accept' | 'drop_stale' | 'drop_epoch' | 'gap' | 'init';

export function classifySeq(
  cursor: { epoch: string; endSeq: number } | null,
  epoch: string,
  seq: number
): SeqDecision {
  if (!cursor) return 'init';
  if (cursor.epoch !== epoch) return 'drop_epoch';
  if (seq <= cursor.endSeq) return 'drop_stale';
  if (seq === cursor.endSeq + 1) return 'accept';
  return 'gap';
}

// ---------------------------------------------------------------------------
// Side-effect discriminated union
// ---------------------------------------------------------------------------

export type ReducerSideEffect =
  | { type: 'catch_up'; cursor: { epoch: string; endSeq: number } | null }
  | { type: 'flush_pending' };

// ---------------------------------------------------------------------------
// Sequenced stream event
// ---------------------------------------------------------------------------

export interface SequencedStreamEvent {
  action: TurnStreamAction;
  seq?: number;
  epoch?: string;
  timestamp: number;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Reducer state and output
// ---------------------------------------------------------------------------

export interface SessionStreamState {
  turns: Map<string, AgentTurn>;
  cursor: TimelineCursor | undefined;
}

export interface ReducerOutput {
  turns: Map<string, AgentTurn>;
  cursor: TimelineCursor | undefined;
  cursorChanged: boolean;
  sideEffects: ReducerSideEffect[];
}

// ---------------------------------------------------------------------------
// Timeline sequencing gate
// ---------------------------------------------------------------------------

interface SequencingGateResult {
  shouldApply: boolean;
  nextCursor: TimelineCursor | null;
  cursorChanged: boolean;
  sideEffects: ReducerSideEffect[];
}

function processSequencingGate(
  event: SequencedStreamEvent,
  currentCursor: TimelineCursor | undefined
): SequencingGateResult {
  const base: SequencingGateResult = {
    shouldApply: true,
    nextCursor: null,
    cursorChanged: false,
    sideEffects: [],
  };

  if (typeof event.seq !== 'number' || typeof event.epoch !== 'string') {
    return base;
  }

  const decision = classifySeq(
    currentCursor ? { epoch: currentCursor.epoch, endSeq: currentCursor.endSeq } : null,
    event.epoch,
    event.seq
  );

  switch (decision) {
    case 'init':
      return {
        ...base,
        nextCursor: { epoch: event.epoch, startSeq: event.seq, endSeq: event.seq },
        cursorChanged: true,
      };

    case 'accept':
      return {
        ...base,
        nextCursor: {
          ...(currentCursor ?? { epoch: event.epoch, startSeq: event.seq, endSeq: event.seq }),
          epoch: event.epoch,
          endSeq: event.seq,
        },
        cursorChanged: true,
      };

    case 'gap':
      return {
        ...base,
        shouldApply: false,
        sideEffects: currentCursor
          ? [
              {
                type: 'catch_up',
                cursor: { epoch: currentCursor.epoch, endSeq: currentCursor.endSeq },
              },
            ]
          : [],
      };

    case 'drop_epoch':
      if (event.seq === 1) {
        return {
          ...base,
          nextCursor: { epoch: event.epoch, startSeq: event.seq, endSeq: event.seq },
          cursorChanged: true,
        };
      }
      // Joining a new epoch past its first event means this consumer missed the
      // epoch's start (e.g. session relaunched while unfocused). Silently
      // dropping here would blank the stream permanently — the epoch never
      // rewinds to seq 1 — so request a canonical catch-up instead.
      return {
        ...base,
        shouldApply: false,
        sideEffects: [{ type: 'catch_up', cursor: null }],
      };

    case 'drop_stale':
      return { ...base, shouldApply: false };
  }
}

// ---------------------------------------------------------------------------
// Apply a single turn stream action to a turns map
// ---------------------------------------------------------------------------

function applyActionToTurns(
  turns: Map<string, AgentTurn>,
  turnId: string,
  workItemId: string,
  action: TurnStreamAction,
  sessionId?: string
): Map<string, AgentTurn> {
  switch (action.type) {
    case 'turn_started': {
      const next = new Map(turns);
      next.set(turnId, {
        id: turnId,
        workItemId,
        agentName: action.agentName,
        items: [],
        status: 'streaming',
        timestamp: Math.floor(action.timestamp / 1000),
        startedAt: action.timestamp,
        sessionId,
      });
      return next;
    }

    case 'item_added': {
      const turn = turns.get(turnId);
      if (!turn) return turns;
      // A catch-up snapshot races the live stream: an item can arrive both in
      // the snapshot and as its original event, so re-adds replace by id.
      const existingIdx = turn.items.findIndex((item) => item.id === action.item.id);
      const items =
        existingIdx === -1
          ? [...turn.items, action.item]
          : turn.items.map((item, idx) => (idx === existingIdx ? action.item : item));
      const next = new Map(turns);
      next.set(turnId, { ...turn, items });
      return next;
    }

    case 'item_updated': {
      const turn = turns.get(turnId);
      if (!turn) return turns;
      const idx = turn.items.findIndex((item) => item.id === action.itemId);
      if (idx === -1) return turns;
      const items = [...turn.items];
      items[idx] = action.item;
      const next = new Map(turns);
      next.set(turnId, { ...turn, items });
      return next;
    }

    case 'turn_completed': {
      const turn = turns.get(turnId);
      if (!turn) return turns;
      const next = new Map(turns);
      next.set(turnId, { ...turn, status: 'complete', completedAt: action.timestamp });
      return next;
    }

    case 'items_batch': {
      let current = turns;
      for (const sub of action.actions) {
        current = applyActionToTurns(current, turnId, workItemId, sub, sessionId);
      }
      return current;
    }
  }
}

// ---------------------------------------------------------------------------
// Process a batch of sequenced events
// ---------------------------------------------------------------------------

// turn_started creates the turn it targets; every other action needs the turn
// to already exist in the map to have any effect.
function actionRequiresExistingTurn(action: TurnStreamAction): boolean {
  if (action.type === 'turn_started') return false;
  if (action.type === 'items_batch') {
    return action.actions.every((sub) => sub.type !== 'turn_started');
  }
  return true;
}

export function processStreamEvents(
  events: Array<{ turnId: string; workItemId: string; event: SequencedStreamEvent }>,
  state: SessionStreamState
): ReducerOutput {
  let turns = state.turns;
  let cursor = state.cursor;
  let cursorChanged = false;
  const sideEffects: ReducerSideEffect[] = [];

  for (const { turnId, workItemId, event } of events) {
    const gate = processSequencingGate(event, cursor);
    sideEffects.push(...gate.sideEffects);

    if (gate.cursorChanged && gate.nextCursor) {
      cursor = gate.nextCursor;
      cursorChanged = true;
    }

    if (gate.shouldApply) {
      if (!turns.has(turnId) && actionRequiresExistingTurn(event.action)) {
        // Mount-mid-turn: this consumer never saw the turn_started, so the
        // action has nothing to apply to. The full turn (including in-flight
        // items) only exists in the main process — fetch it.
        sideEffects.push({
          type: 'catch_up',
          cursor: cursor ? { epoch: cursor.epoch, endSeq: cursor.endSeq } : null,
        });
      } else {
        turns = applyActionToTurns(turns, turnId, workItemId, event.action, event.sessionId);
      }
    }
  }

  // One canonical fetch recovers everything — collapse repeats within a batch.
  const firstCatchUp = sideEffects.findIndex((e) => e.type === 'catch_up');
  const dedupedEffects =
    firstCatchUp === -1
      ? sideEffects
      : sideEffects.filter((e, idx) => e.type !== 'catch_up' || idx === firstCatchUp);

  return { turns, cursor, cursorChanged, sideEffects: dedupedEffects };
}

// ---------------------------------------------------------------------------
// Replace path — full reset from canonical timeline
// ---------------------------------------------------------------------------

export function replaceFromCanonical(
  canonicalTurns: Map<string, AgentTurn>,
  cursor: TimelineCursor | null
): ReducerOutput {
  return {
    turns: canonicalTurns,
    cursor: cursor ?? undefined,
    cursorChanged: true,
    sideEffects: [{ type: 'flush_pending' }],
  };
}

// ---------------------------------------------------------------------------
// Batched stream reducer queue — coalesces high-frequency events
// ---------------------------------------------------------------------------

export interface StreamReducerQueue {
  enqueue: (turnId: string, workItemId: string, event: SequencedStreamEvent) => void;
  flush: () => void;
  dispose: (opts?: { flush?: boolean }) => void;
}

export interface CreateStreamReducerQueueInput {
  getState: () => SessionStreamState;
  commit: (output: ReducerOutput) => void;
  handleSideEffects: (effects: ReducerSideEffect[]) => void;
}

export function createStreamReducerQueue(input: CreateStreamReducerQueueInput): StreamReducerQueue {
  const pending: Array<{ turnId: string; workItemId: string; event: SequencedStreamEvent }> = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  function scheduleFlush(): void {
    if (flushTimer !== null) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, FLUSH_DELAY_MS);
  }

  function cancelFlush(): void {
    if (flushTimer === null) return;
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  function flush(): void {
    if (pending.length === 0) return;
    const batch = pending.splice(0);
    const state = input.getState();
    const output = processStreamEvents(batch, state);
    input.commit(output);
    if (output.sideEffects.length > 0) {
      input.handleSideEffects(output.sideEffects);
    }
  }

  return {
    enqueue(turnId, workItemId, event) {
      pending.push({ turnId, workItemId, event });
      scheduleFlush();
    },
    flush,
    dispose(opts) {
      cancelFlush();
      if (opts?.flush) {
        flush();
      } else {
        pending.length = 0;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Optimistic user message utilities
// ---------------------------------------------------------------------------

export interface OptimisticUserMessage {
  id: string;
  text: string;
  timestamp: number;
}

export function reconcileOptimisticMessages(
  canonicalItems: StreamItem[],
  optimistic: OptimisticUserMessage[]
): StreamItem[] {
  if (optimistic.length === 0) return canonicalItems;

  const result = [...canonicalItems];
  for (const opt of optimistic) {
    const exists = result.some((item) => item.kind === 'text' && item.id === opt.id);
    if (!exists) {
      result.push({ kind: 'text', id: opt.id, text: opt.text });
    }
  }
  return result;
}
