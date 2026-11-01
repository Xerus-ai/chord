import { randomUUID } from 'node:crypto';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import type {
  StreamItem,
  ToolCallItem,
  ToolCallStatus,
  ToolContentBlock,
  ToolFileLocation,
} from '@shared/stream-items';
import { toolLocationsFromRawInput, type DocumentWriteRecorder } from './record-document-writes';
import type { TurnItemStream } from './stream-turn-items';
import { synthesizeTaskList } from './synthesize-task-list';

type ToolGroupItem = StreamItem & { kind: 'tool_group' };

const isToolGroup = (item: StreamItem): item is ToolGroupItem => item.kind === 'tool_group';

function toToolStatus(status: string): ToolCallStatus {
  if (status === 'in_progress') return 'in_progress';
  if (status === 'completed') return 'completed';
  if (status === 'failed') return 'failed';
  return 'pending';
}

/** Consecutive tool calls share one card — a new group only starts once some
    other item (text, thinking, artifact) has interrupted the run. */
export function appendToolCall(
  stream: TurnItemStream,
  writes: DocumentWriteRecorder,
  workItemId: string,
  event: AgentOutputEvent & { type: 'tool_call' }
): void {
  stream.finalizeThoughts();

  const contentBlocks: ToolContentBlock[] | undefined = event.content?.map((c) => ({
    type: c.type,
    text: c.text,
    diff: c.diff,
  }));
  const locations: ToolFileLocation[] | undefined = event.locations?.map((l) => ({
    filePath: writes.resolveReportedPath(l.filePath),
    startLine: l.startLine,
    endLine: l.endLine,
  }));

  if (event.status === 'completed') {
    writes.recordCompletedToolCall(event, locations);
  }

  const existing = findToolByCallId(stream, event.callId);
  if (existing) {
    existing.tool.status = toToolStatus(event.status);
    if (contentBlocks && contentBlocks.length > 0) existing.tool.contentBlocks = contentBlocks;
    if (locations && locations.length > 0) existing.tool.locations = locations;
    if (event.rawInput && !existing.tool.rawInput) existing.tool.rawInput = event.rawInput;
    if (event.rawInput) synthesizeTaskList(stream, workItemId, existing.tool);
    stream.update(workItemId, existing.group);
    return;
  }

  const tool: ToolCallItem = {
    callId: event.callId,
    name: event.name,
    status: toToolStatus(event.status),
    kind: event.kind ?? 'execute',
    contentBlocks,
    locations,
    rawInput: event.rawInput,
  };

  if (tool.rawInput) synthesizeTaskList(stream, workItemId, tool);

  const last = stream.lastItem();
  if (last && isToolGroup(last)) {
    last.tools.push(tool);
    stream.update(workItemId, last);
    return;
  }

  stream.add(workItemId, { kind: 'tool_group', id: randomUUID(), tools: [tool] });
}

export function updateToolCall(
  stream: TurnItemStream,
  writes: DocumentWriteRecorder,
  workItemId: string,
  callId: string,
  status: string | undefined,
  rawInput?: Record<string, unknown>,
  content?: Array<{ type: string; text?: string; diff?: string }>
): void {
  const existing = findToolByCallId(stream, callId);
  if (!existing) return;
  const { tool, group } = existing;

  if (status) tool.status = status as ToolCallStatus;
  const hasInput = rawInput !== undefined && Object.keys(rawInput).length > 0;
  if (hasInput) tool.rawInput = rawInput;
  if (content && content.length > 0) {
    tool.contentBlocks = content.map((c) => ({
      type: c.type as 'text' | 'diff',
      text: c.text,
      diff: c.diff,
    }));
  }
  if (hasInput) synthesizeTaskList(stream, workItemId, tool);
  if (status === 'completed') {
    const locations = tool.locations ?? toolLocationsFromRawInput(tool.rawInput);
    if (locations) {
      writes.recordToolLocations(tool.name, locations);
    }
  }
  stream.update(workItemId, group);
}

function findToolByCallId(
  stream: TurnItemStream,
  callId: string
): { tool: ToolCallItem; group: ToolGroupItem } | null {
  for (const item of stream.listItems()) {
    if (!isToolGroup(item)) continue;
    const tool = item.tools.find((t) => t.callId === callId);
    if (tool) return { tool, group: item };
  }
  return null;
}
