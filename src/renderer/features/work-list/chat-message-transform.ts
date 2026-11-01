import type { CloudChatMessage } from '@chord/protocol';
import type {
  ChatEntry,
  ContentBlock,
  FileBadgeData,
  PermissionOptionData,
  PlanEntryData,
  PullRequestCardData,
  SystemEventEntry,
  ToolCallKind,
  ToolCallStatus,
} from './chat-types';

export function deriveInitials(name: string): string {
  return name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

// Shared: `toLocaleTimeString` with options builds a formatter per call, and a
// thread formats every row's time as it loads (54 ms of a 1,280-row open).
const TIME_FORMAT = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const DAY_FORMAT = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
const DAY_YEAR_FORMAT = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
});

export function formatTime(epochSeconds: number): string {
  const date = new Date(epochSeconds * 1000);
  const time = TIME_FORMAT.format(date);
  // Time alone reads as "today" — an old message must carry its date or a
  // reseeded July row looks like it was sent this afternoon.
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return time;
  const day = (date.getFullYear() === now.getFullYear() ? DAY_FORMAT : DAY_YEAR_FORMAT).format(
    date
  );
  return `${day}, ${time}`;
}

/**
 * One row's `metadata` column. It is written by the main process but read back
 * from SQLite and from the cloud, so a truncated or hand-edited row is
 * possible — and an uncaught throw here propagates out of the map() that
 * builds the whole history, blanking every message in the chat. Returning null
 * lets the caller degrade the single bad row instead.
 */
function parseRowMetadata(metadata: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(metadata);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

/** A system row's history event (Reset marker, fork head); null for any other or a malformed one. */
function readHistoryEvent(meta: Record<string, unknown>): SystemEventEntry['event'] | null {
  if (meta.event === 'history_reset' && typeof meta.targetTurnId === 'string') {
    return { type: 'history_reset', targetTurnId: meta.targetTurnId };
  }
  if (
    meta.event === 'forked_from' &&
    typeof meta.sourceTitle === 'string' &&
    typeof meta.forkedAt === 'number'
  ) {
    return { type: 'forked_from', sourceTitle: meta.sourceTitle, forkedAt: meta.forkedAt };
  }
  return null;
}

/** The visible stand-in for a row whose metadata could not be read. */
function degradedEntry(id: string, createdAt: number, createdAtMs: number): ChatEntry {
  return {
    kind: 'system-event',
    id,
    commitHash: '',
    message: 'This message could not be read — its stored content is corrupt.',
    createdAt,
    createdAtMs,
    degraded: true,
  };
}

type ChatRowShape = {
  id: string;
  workItemId: string;
  /** `chat_messages.session_id` — the agent session that produced the row. */
  sessionId?: string | null;
  senderType: string;
  senderId: string | null;
  senderName: string | null;
  content: string;
  messageType: string;
  metadata: string | null;
  createdAt: number;
  createdAtMs: number;
};

/** Maps a local row (or a cloud row in local shape) to a ChatEntry, keeping its session provenance. */
export function dbRowToChatEntry(row: ChatRowShape): ChatEntry {
  const entry = rowToChatEntry(row);
  return row.sessionId ? { ...entry, sessionId: row.sessionId } : entry;
}

/** A cloud row (REST page or socket frame) mapped through the local-row shape. */
export function cloudMessageToChatEntry(msg: CloudChatMessage): ChatEntry {
  return dbRowToChatEntry({
    id: msg.id,
    workItemId: msg.work_item_id,
    sessionId: msg.session_id,
    senderType: msg.sender_type,
    senderId: msg.sender_id,
    senderName: msg.sender_name,
    content: msg.content,
    messageType: msg.message_type,
    metadata: JSON.stringify(msg.metadata ?? {}),
    createdAt: Math.floor(Date.parse(msg.created_at) / 1000),
    createdAtMs: Date.parse(msg.created_at),
  });
}

/** The cloud rows one agent session produced, as entries. */
export function sessionCloudEntries(
  rows: readonly CloudChatMessage[],
  sessionId: string
): ChatEntry[] {
  return rows.filter((r) => r.session_id === sessionId).map(cloudMessageToChatEntry);
}

function rowToChatEntry(row: ChatRowShape): ChatEntry {
  const metadata = row.metadata ?? '{}';
  if (row.messageType === 'agent_turn') {
    return {
      kind: 'system-event',
      id: row.id,
      commitHash: '',
      message: '',
      createdAt: row.createdAt,
      createdAtMs: row.createdAtMs,
    };
  }
  if (row.messageType === 'commit' || row.senderType === 'system') {
    const commitMeta = parseRowMetadata(metadata);
    if (!commitMeta) return degradedEntry(row.id, row.createdAt, row.createdAtMs);
    const event = readHistoryEvent(commitMeta);
    return {
      kind: 'system-event',
      id: row.id,
      commitHash: typeof commitMeta.commitHash === 'string' ? commitMeta.commitHash : '',
      message: row.content,
      createdAt: row.createdAt,
      createdAtMs: row.createdAtMs,
      ...(event ? { event } : {}),
    };
  }

  const blocks: ContentBlock[] = [];
  const parsedMeta = parseRowMetadata(metadata);
  if (!parsedMeta) return degradedEntry(row.id, row.createdAt, row.createdAtMs);
  const meta = parsedMeta;

  switch (row.messageType) {
    case 'tool_call': {
      const tc = meta as {
        callId?: string;
        name?: string;
        status?: ToolCallStatus;
        kind?: ToolCallKind;
        content?: Array<{ type: string; text?: string }>;
      };
      if (tc.callId) {
        const contentText = tc.content?.map((c) => c.text ?? '').join('\n') ?? '';
        blocks.push({
          type: 'tool-call-rich',
          data: {
            callId: tc.callId,
            name: tc.name ?? row.content,
            status: tc.status ?? 'completed',
            kind: tc.kind ?? 'unknown',
            summary: row.content,
            content: contentText || undefined,
          },
        });
      } else {
        blocks.push({ type: 'tool-call', summary: row.content });
      }
      break;
    }
    case 'reasoning':
      blocks.push({ type: 'reasoning', text: row.content, status: 'ready' });
      break;
    case 'permission': {
      const pm = meta as {
        requestId: string;
        name: string;
        kind: string;
        title?: string;
        input?: Record<string, unknown>;
        options: PermissionOptionData[];
      };
      blocks.push({
        type: 'permission',
        requestId: pm.requestId,
        name: pm.name,
        title: pm.title ?? pm.name,
        command: pm.input?.command as string | undefined,
        options: pm.options ?? [],
      });
      break;
    }
    case 'plan': {
      const pl = meta as { entries: Array<{ text: string; completed?: boolean; status?: string }> };
      const entries: PlanEntryData[] = (pl.entries ?? []).map((e) => ({
        text: e.text,
        completed: e.completed ?? e.status === 'completed',
      }));
      blocks.push({
        type: 'plan',
        entries,
        completedCount: entries.filter((e) => e.completed).length,
        totalCount: entries.length,
      });
      break;
    }
    case 'plan_approval': {
      const pa = meta as {
        artifactId: string;
        planItemId?: string;
        requestId?: string;
        title: string;
        overview: string;
        steps: Array<{ text: string; completed?: boolean }>;
        status: 'pending' | 'approved' | 'rejected' | 'adjusted';
        rationale?: string;
        planMarkdown?: string;
      };
      const paEntries: PlanEntryData[] = (pa.steps ?? []).map((e) => ({
        text: e.text,
        completed: e.completed ?? false,
      }));
      blocks.push({
        type: 'plan-approval',
        artifactId: pa.artifactId ?? '',
        // The plan ledger keys resolution by the stream item id; the cloud
        // wire calls the same value requestId (plan-publication-service).
        planItemId: pa.planItemId ?? pa.requestId,
        title: pa.title ?? 'Implementation Plan',
        overview: pa.overview ?? '',
        steps: paEntries,
        status: pa.status ?? 'approved',
        rationale: pa.rationale,
        planMarkdown: pa.planMarkdown,
      });
      break;
    }
    case 'error':
      blocks.push({ type: 'error', message: row.content });
      break;
    case 'file_change': {
      const fileMeta = meta as { files?: FileBadgeData[] };
      blocks.push({ type: 'file-badges', files: fileMeta.files ?? [] });
      break;
    }
    case 'artifact': {
      const artMeta = meta as {
        artifactId?: string;
        title: string;
        meta: string;
        hasApprove?: boolean;
      };
      blocks.push({ type: 'artifact', data: artMeta });
      break;
    }
    case 'pull_request': {
      const prMeta = meta as unknown as PullRequestCardData;
      blocks.push({ type: 'pr-card', data: prMeta });
      break;
    }
    default:
      blocks.push({ type: 'text', text: row.content });
  }

  const sender: 'human' | 'agent' = row.senderType === 'agent' ? 'agent' : 'human';
  const name = row.senderName ?? (sender === 'agent' ? 'Agent' : 'User');

  return {
    kind: 'message',
    id: row.id,
    sender,
    senderId: row.senderId,
    name,
    initials: sender === 'agent' ? 'D' : deriveInitials(name),
    time: formatTime(row.createdAt),
    createdAt: row.createdAt,
    createdAtMs: row.createdAtMs,
    blocks,
  };
}
