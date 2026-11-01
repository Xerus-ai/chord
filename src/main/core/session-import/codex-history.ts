import type { ImportableSession } from '@shared/session-import';
import { describeCommand, toToolStatus } from '@main/core/codex-app-server/codex-event-mapper';
import type { Thread } from '@main/core/codex-app-server/protocol/v2/Thread';
import type { ThreadItem } from '@main/core/codex-app-server/protocol/v2/ThreadItem';
import type { ThreadListParams } from '@main/core/codex-app-server/protocol/v2/ThreadListParams';
import type { ThreadSourceKind } from '@main/core/codex-app-server/protocol/v2/ThreadSourceKind';
import type { ThreadTurnsListParams } from '@main/core/codex-app-server/protocol/v2/ThreadTurnsListParams';
import type { Turn } from '@main/core/codex-app-server/protocol/v2/Turn';
import type { UserInput } from '@main/core/codex-app-server/protocol/v2/UserInput';
import { comparablePath } from '@main/core/utils/comparable-path';
import type { AgentPathEnvironment } from '@main/utils/agent-reported-path';
import { IMAGE_MARKER } from './claude-transcript';
import { ImportTranscriptBuilder, type ImportedMessage } from './transcript-builder';

/** `clientInfo.name` Chord's app-server client sends; its threads carry it as originator. */
const CHORD_ORIGINATOR = 'chord';

/**
 * Every source a person starts a thread from. Without `sourceKinds` the
 * app-server returns only cli and vscode threads, so `codex exec` threads were
 * missed (spike S5); subagent threads are a parent's, not a conversation.
 */
const USER_SOURCE_KINDS: ThreadSourceKind[] = ['cli', 'vscode', 'exec', 'appServer', 'unknown'];

const PAGE_SIZE = 100;

export function buildCodexThreadListParams(cwd: string, cursor: string | null): ThreadListParams {
  return { cwd, sourceKinds: USER_SOURCE_KINDS, archived: false, limit: PAGE_SIZE, cursor };
}

/** Full items, oldest first: the default `summary` view drops command executions (spike S5). */
export function buildCodexTurnsPageParams(
  threadId: string,
  cursor: string | null
): ThreadTurnsListParams {
  return { threadId, cursor, itemsView: 'full', sortDirection: 'asc' };
}

/** The lane's threads Chord did not start and does not hold, titled by name, else first prompt. */
export function selectImportableCodexThreads(
  threads: Thread[],
  lanePath: string,
  owned: ReadonlySet<string>
): ImportableSession[] {
  const lane = comparablePath(lanePath);
  return threads
    .filter(
      (thread) =>
        thread.originator !== CHORD_ORIGINATOR &&
        thread.parentThreadId === null &&
        !owned.has(thread.id) &&
        comparablePath(thread.cwd) === lane
    )
    .map((thread) => ({
      providerId: 'codex' as const,
      providerSessionId: thread.id,
      title: thread.name ?? (thread.preview || null),
      lastActivityAt: thread.updatedAt * 1000,
      cwd: lanePath,
    }));
}

function userText(content: UserInput[]): string {
  return content
    .map((input) => {
      switch (input.type) {
        case 'text':
          return input.text;
        case 'image':
        case 'localImage':
          return IMAGE_MARKER;
        case 'skill':
          return `$${input.name}`;
        case 'mention':
          return `@${input.name}`;
        case 'audio':
        case 'localAudio':
          return '[audio]';
      }
    })
    .join('\n\n');
}

/** One item, the way the live chat shows it (`codex-event-mapper.ts`); items it does not draw are skipped. */
function foldItem(builder: ImportTranscriptBuilder, item: ThreadItem, at: number): void {
  switch (item.type) {
    case 'userMessage':
      builder.prompt(userText(item.content), at);
      return;
    case 'agentMessage':
      builder.openTextBlock();
      builder.appendText(item.text, at);
      return;
    case 'plan':
      builder.openTextBlock();
      builder.appendText(item.text, at);
      return;
    case 'reasoning':
      builder.thinking((item.summary.length > 0 ? item.summary : item.content).join('\n\n'), at);
      return;
    case 'commandExecution':
      builder.toolCall(
        {
          callId: item.id,
          name: 'Shell',
          kind: 'execute',
          status: toToolStatus(item.status),
          rawInput: { command: describeCommand(item) },
          contentBlocks: item.aggregatedOutput
            ? [{ type: 'text', text: item.aggregatedOutput }]
            : [],
        },
        at
      );
      return;
    case 'fileChange':
      builder.toolCall(
        {
          callId: item.id,
          name: 'Edit',
          kind: 'edit',
          status: toToolStatus(item.status),
          rawInput: { path: item.changes[0]?.path },
          locations: item.changes.map((change) => ({ filePath: change.path })),
          contentBlocks: item.changes.map((change) => ({
            type: 'diff' as const,
            diff: change.diff,
          })),
        },
        at
      );
      return;
    case 'mcpToolCall':
      builder.toolCall(
        {
          callId: item.id,
          name: `${item.server}.${item.tool}`,
          kind: 'execute',
          status: toToolStatus(item.status),
          rawInput:
            typeof item.arguments === 'object' && item.arguments !== null
              ? (item.arguments as Record<string, unknown>)
              : undefined,
        },
        at
      );
      return;
    default:
      return;
  }
}

/** A Codex thread's turns as chat rows, at the turns' own times. */
export function buildCodexImportMessages(
  turns: Turn[],
  cwd: string,
  environment?: AgentPathEnvironment
): ImportedMessage[] {
  const builder = new ImportTranscriptBuilder(cwd, environment);
  for (const turn of turns) {
    const startedAt = turn.startedAt ?? turn.completedAt;
    if (startedAt === null) throw new Error(`Codex turn ${turn.id} has no time`);
    const at = startedAt * 1000;
    for (const item of turn.items) foldItem(builder, item, at);
    if (turn.status === 'failed' && turn.error) builder.error(turn.error.message, at);
    builder.endTurn((turn.completedAt ?? startedAt) * 1000);
  }
  return builder.finish();
}
