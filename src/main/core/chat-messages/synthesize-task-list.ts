import { randomUUID } from 'node:crypto';
import type { StreamItem, TaskListEntry, ToolCallItem } from '@shared/stream-items';
import type { TurnItemStream } from './stream-turn-items';

type TaskListItem = StreamItem & { kind: 'task_list' };

const isTaskList = (item: StreamItem): item is TaskListItem => item.kind === 'task_list';
const DONE_STATUS_PATTERN = /^(completed|done|closed|resolved|finished)$/i;

/**
 * The agent's own task tooling is the only source of the checklist card: a
 * TodoWrite/TaskCreate/TaskUpdate call is mirrored into the single `task_list`
 * item of the turn rather than rendering as a raw tool call.
 */
export function synthesizeTaskList(
  stream: TurnItemStream,
  workItemId: string,
  tool: ToolCallItem
): void {
  const name = tool.name.toLowerCase();
  if (!tool.rawInput) return;
  const input = tool.rawInput;

  if (name === 'todowrite') {
    if (!Array.isArray(input.todos)) return;
    const entries = (input.todos as Array<Record<string, unknown>>).map((t) => ({
      text: (t.content ?? t.description ?? t.title ?? '') as string,
      completed: t.status === 'completed',
      status: (t.status ?? 'in_progress') as string,
    }));
    replaceTaskList(stream, workItemId, 'Tasks', entries);
    return;
  }

  if (name === 'taskcreate') {
    const desc = (input.description ?? input.prompt ?? input.name ?? input.task ?? '') as string;
    if (!desc) return;
    const entry: TaskListEntry = {
      text: desc,
      completed: false,
      status: 'pending',
      sourceCallId: tool.callId,
    };
    const existing = stream.findItem(isTaskList);
    if (existing) {
      existing.entries.push(entry);
      existing.totalCount = existing.entries.length;
      stream.update(workItemId, existing);
      return;
    }
    replaceTaskList(stream, workItemId, 'Tasks', [entry]);
    return;
  }

  if (name === 'taskupdate') {
    const existing = stream.findItem(isTaskList);
    if (!existing) return;
    const newStatus = (input.status ?? '') as string;
    if (!newStatus) return;

    const uncompleted = existing.entries.find((e) => !e.completed);
    if (uncompleted) {
      uncompleted.completed = DONE_STATUS_PATTERN.test(newStatus);
      uncompleted.status = newStatus;
    }
    existing.completedCount = existing.entries.filter((e) => e.completed).length;
    stream.update(workItemId, existing);
  }
}

/** Progress on an already-approved plan renders as the same checklist card. */
export function upsertPlanTaskList(
  stream: TurnItemStream,
  workItemId: string,
  entries: TaskListEntry[]
): void {
  replaceTaskList(stream, workItemId, 'Plan', entries);
}

function replaceTaskList(
  stream: TurnItemStream,
  workItemId: string,
  title: string,
  entries: TaskListEntry[]
): void {
  const completedCount = entries.filter((e) => e.completed).length;
  const existing = stream.findItem(isTaskList);
  if (existing) {
    existing.entries = entries;
    existing.completedCount = completedCount;
    existing.totalCount = entries.length;
    stream.update(workItemId, existing);
    return;
  }

  stream.add(workItemId, {
    kind: 'task_list',
    id: randomUUID(),
    title,
    entries,
    completedCount,
    totalCount: entries.length,
  });
}
