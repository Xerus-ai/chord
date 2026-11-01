import type { AcpPermissionOption } from '@shared/acp-types';
import type { JsonValue } from './protocol/serde_json/JsonValue';
import type { McpServerElicitationRequestParams } from './protocol/v2/McpServerElicitationRequestParams';
import type { McpServerElicitationRequestResponse } from './protocol/v2/McpServerElicitationRequestResponse';

/**
 * Codex asks before running an MCP tool the user has not allowed yet (its
 * `tool_call_mcp_elicitation` feature, on by default) by sending an MCP
 * elicitation with an empty form, marked in `_meta`. It is a yes/no approval,
 * so it becomes a permission card; the options and replies follow the Codex
 * TUI (`tui/src/bottom_pane/mcp_server_elicitation.rs`).
 */

type Meta = { [key: string]: JsonValue | undefined };

function metaOf(params: McpServerElicitationRequestParams): Meta | null {
  if (params.mode !== 'form') return null;
  const meta = params._meta;
  return typeof meta === 'object' && meta !== null && !Array.isArray(meta) ? meta : null;
}

function hasEmptyForm(params: McpServerElicitationRequestParams): boolean {
  if (params.mode !== 'form') return false;
  const schema = params.requestedSchema;
  return schema === null || Object.keys(schema.properties).length === 0;
}

export function isMcpToolApproval(params: McpServerElicitationRequestParams): boolean {
  return metaOf(params)?.codex_approval_kind === 'mcp_tool_call' && hasEmptyForm(params);
}

/** The ways the server lets an approval be remembered: `session`, `always`. */
function persistModes(meta: Meta): string[] {
  const persist = meta.persist;
  if (typeof persist === 'string') return [persist];
  return Array.isArray(persist) ? persist.filter((m): m is string => typeof m === 'string') : [];
}

/**
 * Allow once, one remembered allow (the card has room for one: this session
 * when offered, else always), and Cancel — which stops the tool call, as the
 * TUI's only refusal for a tool approval.
 */
function approvalOptions(params: McpServerElicitationRequestParams): AcpPermissionOption[] {
  const modes = persistModes(metaOf(params) ?? {});
  const options: AcpPermissionOption[] = [
    { optionId: 'accept', name: 'Allow', kind: 'allow_once' },
  ];
  if (modes.includes('session')) {
    options.push({
      optionId: 'acceptForSession',
      name: 'Allow for this session',
      kind: 'allow_always',
    });
  } else if (modes.includes('always')) {
    options.push({ optionId: 'acceptAlways', name: 'Always allow', kind: 'allow_always' });
  }
  options.push({ optionId: 'cancel', name: 'Cancel', kind: 'reject_once' });
  return options;
}

/** The tool's arguments as the server labels them, one per line. */
function describeArguments(meta: Meta): string | undefined {
  const display = meta.tool_params_display;
  if (!Array.isArray(display) || display.length === 0) return undefined;
  return display
    .map((param) => {
      if (typeof param !== 'object' || param === null || Array.isArray(param)) {
        throw new Error('Codex sent a tool argument that is not an object');
      }
      const value = typeof param.value === 'string' ? param.value : JSON.stringify(param.value);
      return `${String(param.display_name ?? param.name)}: ${value}`;
    })
    .join('\n');
}

export function toMcpToolApprovalCard(params: McpServerElicitationRequestParams): {
  name: string;
  title: string;
  command: string | undefined;
  options: AcpPermissionOption[];
} {
  const meta = metaOf(params);
  if (!meta || params.mode !== 'form') throw new Error('Not an MCP tool call approval');
  return {
    name: typeof meta.tool_title === 'string' ? meta.tool_title : params.serverName,
    title: params.message,
    command: describeArguments(meta),
    options: approvalOptions(params),
  };
}

/** The reply for the option picked; it must be one the card offered. */
export function toMcpToolApprovalResponse(
  optionId: string,
  params: McpServerElicitationRequestParams
): McpServerElicitationRequestResponse {
  if (!approvalOptions(params).some((option) => option.optionId === optionId)) {
    throw new Error(`Codex did not offer "${optionId}" for this tool call`);
  }
  switch (optionId) {
    case 'accept':
      return { action: 'accept', content: null, _meta: null };
    case 'acceptForSession':
      return { action: 'accept', content: null, _meta: { persist: 'session' } };
    case 'acceptAlways':
      return { action: 'accept', content: null, _meta: { persist: 'always' } };
    default:
      return { action: 'cancel', content: null, _meta: null };
  }
}
