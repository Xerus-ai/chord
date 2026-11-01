import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import type { AgentEventBridge } from '@main/core/chat-messages/agent-event-bridge';

export function bridgeSDKEvent(
  bridge: AgentEventBridge,
  workItemId: string,
  event: AgentOutputEvent
): void {
  switch (event.type) {
    case 'reasoning':
      bridge.handleAcpUpdate(workItemId, {
        sessionUpdate: 'agent_thought_chunk',
        content: { type: 'text', text: event.text },
      });
      break;
    case 'text':
      bridge.handleAcpUpdate(workItemId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: event.text },
        messageId: event.messageId,
      });
      break;
    case 'text_block_start':
      bridge.handleAcpUpdate(workItemId, {
        sessionUpdate: 'agent_message_chunk',
        content: { type: 'text', text: '' },
      });
      break;
    case 'tool_call':
      bridge.handleAcpUpdate(workItemId, {
        sessionUpdate: 'tool_call',
        toolCallId: event.callId,
        status: event.status,
        title: event.name,
        kind: event.kind as 'read' | 'edit' | 'execute' | undefined,
        rawInput: event.rawInput,
        content: event.content,
        locations: event.locations,
      });
      break;
    case 'tool_call_update':
      bridge.handleAcpUpdate(workItemId, {
        sessionUpdate: 'tool_call_update',
        toolCallId: event.callId,
        status: event.status,
        rawInput: event.rawInput,
        content: event.content,
      });
      break;
    case 'error':
      bridge.handleError(workItemId, new Error(event.message));
      break;
    case 'turn_completed':
      bridge.completeTurn(workItemId, { historyRef: event.historyRef });
      break;
    case 'usage':
      bridge.recordUsage(event);
      break;
    case 'permission_request':
      bridge.handlePermission(workItemId, {
        requestId: event.requestId,
        name: event.name,
        kind: event.kind,
        title: event.title,
        input: event.input,
        options: event.options,
      });
      break;
    case 'plan':
      bridge.handleAcpUpdate(workItemId, {
        sessionUpdate: 'plan',
        entries: event.entries,
      });
      break;
    case 'plan_request':
      bridge.handlePlanRequest(workItemId, event);
      break;
    case 'question_request':
      bridge.handleQuestionRequest(workItemId, event);
      break;
    default:
      break;
  }
}
