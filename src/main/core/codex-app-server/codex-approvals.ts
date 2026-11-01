import type { AcpPermissionOption } from '@shared/acp-types';
import type { AgentOutputEvent } from '@shared/events/agentOutputEvents';
import { describeCommand, describeFileChange } from './codex-event-mapper';
import {
  isMcpToolApproval,
  toMcpToolApprovalCard,
  toMcpToolApprovalResponse,
} from './codex-mcp-tool-approval';
import {
  toPermissionsApprovalCard,
  toPermissionsApprovalResponse,
} from './codex-permissions-approval';
import type { CommandExecutionApprovalDecision } from './protocol/v2/CommandExecutionApprovalDecision';
import type { CommandExecutionRequestApprovalParams } from './protocol/v2/CommandExecutionRequestApprovalParams';
import type { FileChangeApprovalDecision } from './protocol/v2/FileChangeApprovalDecision';
import type { McpServerElicitationRequestParams } from './protocol/v2/McpServerElicitationRequestParams';
import type { McpServerElicitationRequestResponse } from './protocol/v2/McpServerElicitationRequestResponse';
import type { PermissionsRequestApprovalParams } from './protocol/v2/PermissionsRequestApprovalParams';
import type { PermissionsRequestApprovalResponse } from './protocol/v2/PermissionsRequestApprovalResponse';
import type { ThreadItem } from './protocol/v2/ThreadItem';

export const COMMAND_APPROVAL_METHOD = 'item/commandExecution/requestApproval';
export const FILE_CHANGE_APPROVAL_METHOD = 'item/fileChange/requestApproval';
export const PERMISSIONS_APPROVAL_METHOD = 'item/permissions/requestApproval';
export const MCP_ELICITATION_METHOD = 'mcpServer/elicitation/request';

/**
 * Whether a server request is a yes/no approval, answered with a permission
 * card. Questions (`item/tool/requestUserInput`) and MCP data forms need
 * answers typed in, which no Chord card takes yet.
 */
export function isCodexApprovalRequest(method: string, params: unknown): boolean {
  switch (method) {
    case COMMAND_APPROVAL_METHOD:
    case FILE_CHANGE_APPROVAL_METHOD:
    case PERMISSIONS_APPROVAL_METHOD:
      return true;
    case MCP_ELICITATION_METHOD:
      return isMcpToolApproval(params as McpServerElicitationRequestParams);
    default:
      return false;
  }
}

type PermissionRequestEvent = Extract<AgentOutputEvent, { type: 'permission_request' }>;
type Decision = CommandExecutionApprovalDecision | FileChangeApprovalDecision;

/** A file change request names no decisions; these are the protocol's own, minus `cancel`. */
const FILE_CHANGE_DECISIONS: FileChangeApprovalDecision[] = [
  'accept',
  'acceptForSession',
  'decline',
];

const OPTION_TEXT: Record<string, Omit<AcpPermissionOption, 'optionId'>> = {
  accept: { name: 'Allow', kind: 'allow_once' },
  acceptForSession: { name: 'Allow for this session', kind: 'allow_always' },
  acceptWithExecpolicyAmendment: { name: 'Always allow this command', kind: 'allow_always' },
  decline: { name: 'Decline', kind: 'reject_once' },
  cancel: { name: 'Decline and stop', kind: 'reject_always' },
};

/** A decision's option id: the string itself, or the key of an object decision. */
function decisionId(decision: Decision): string {
  return typeof decision === 'string' ? decision : Object.keys(decision)[0];
}

function offeredDecisions(method: string, params: unknown): Decision[] {
  if (method === FILE_CHANGE_APPROVAL_METHOD) return FILE_CHANGE_DECISIONS;
  if (method !== COMMAND_APPROVAL_METHOD) throw new Error(`Not a Codex approval: ${method}`);
  const offered = (params as CommandExecutionRequestApprovalParams).availableDecisions;
  if (!offered || offered.length === 0) {
    throw new Error('Codex asked for command approval without offering a decision');
  }
  return offered;
}

/**
 * A Codex approval request as the chat's permission card, offering exactly
 * the decisions the server will accept. `item` is the tool item the request
 * is about (from its `item/started`): a file change request names only the
 * item, so its files come from there.
 */
export function toCodexPermissionRequest(
  requestId: string,
  method: string,
  params: unknown,
  item: ThreadItem | undefined
): PermissionRequestEvent {
  if (method === PERMISSIONS_APPROVAL_METHOD || method === MCP_ELICITATION_METHOD) {
    const card =
      method === PERMISSIONS_APPROVAL_METHOD
        ? toPermissionsApprovalCard(params as PermissionsRequestApprovalParams)
        : toMcpToolApprovalCard(params as McpServerElicitationRequestParams);
    return {
      type: 'permission_request',
      requestId,
      name: card.name,
      kind: 'other',
      title: card.title,
      input: card.command === undefined ? {} : { command: card.command },
      options: card.options,
    };
  }
  const options = offeredDecisions(method, params)
    .map(decisionId)
    .filter((id) => OPTION_TEXT[id] !== undefined)
    .map((id) => ({ optionId: id, ...OPTION_TEXT[id] }));
  if (method === COMMAND_APPROVAL_METHOD) {
    const request = params as CommandExecutionRequestApprovalParams;
    const command =
      item?.type === 'commandExecution' ? describeCommand(item) : (request.command ?? '');
    return {
      type: 'permission_request',
      requestId,
      name: 'Shell',
      kind: 'execute',
      title: `Run ${command}`,
      input: { command },
      options,
    };
  }
  if (item?.type !== 'fileChange') {
    throw new Error(`Codex asked to approve file change ${requestId} for an unknown item`);
  }
  return {
    type: 'permission_request',
    requestId,
    name: 'Edit',
    kind: 'edit',
    title: describeFileChange(item),
    input: { path: item.changes[0]?.path },
    options,
  };
}

/** The reply to an approval request for the option the user picked; it must be one offered. */
export function toCodexApprovalResponse(
  optionId: string,
  method: string,
  params: unknown
):
  | { decision: Decision }
  | PermissionsRequestApprovalResponse
  | McpServerElicitationRequestResponse {
  if (method === PERMISSIONS_APPROVAL_METHOD) {
    return toPermissionsApprovalResponse(optionId, params as PermissionsRequestApprovalParams);
  }
  if (method === MCP_ELICITATION_METHOD) {
    return toMcpToolApprovalResponse(optionId, params as McpServerElicitationRequestParams);
  }
  const decision = offeredDecisions(method, params).find((d) => decisionId(d) === optionId);
  if (decision === undefined) {
    throw new Error(`Codex did not offer "${optionId}" for this approval`);
  }
  return { decision };
}
