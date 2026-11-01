import { describe, expect, it } from 'vitest';
import {
  COMMAND_APPROVAL_METHOD,
  FILE_CHANGE_APPROVAL_METHOD,
  isCodexApprovalRequest,
  MCP_ELICITATION_METHOD,
  PERMISSIONS_APPROVAL_METHOD,
  toCodexApprovalResponse,
  toCodexPermissionRequest,
} from './codex-approvals';
import { COMMAND_APPROVAL, FILE_CHANGE_APPROVAL } from './codex-captured-messages';
import {
  FILE_PERMISSIONS_APPROVAL,
  MCP_FORM_ELICITATION,
  MCP_TOOL_APPROVAL,
  PERMISSIONS_APPROVAL,
  USER_INPUT_REQUEST,
} from './codex-captured-requests';

describe('isCodexApprovalRequest', () => {
  it('takes every request a permission card can answer', () => {
    expect(isCodexApprovalRequest(COMMAND_APPROVAL_METHOD, COMMAND_APPROVAL)).toBe(true);
    expect(isCodexApprovalRequest(FILE_CHANGE_APPROVAL_METHOD, FILE_CHANGE_APPROVAL)).toBe(true);
    expect(isCodexApprovalRequest(PERMISSIONS_APPROVAL_METHOD, PERMISSIONS_APPROVAL)).toBe(true);
    expect(isCodexApprovalRequest(MCP_ELICITATION_METHOD, MCP_TOOL_APPROVAL)).toBe(true);
  });

  it('leaves questions and data forms, which need answers typed in', () => {
    expect(isCodexApprovalRequest(MCP_ELICITATION_METHOD, MCP_FORM_ELICITATION)).toBe(false);
    expect(isCodexApprovalRequest('item/tool/requestUserInput', USER_INPUT_REQUEST)).toBe(false);
  });
});

describe('an MCP tool call approval', () => {
  const method = MCP_ELICITATION_METHOD;

  it('is a card naming the tool, with its arguments and the persist mode offered', () => {
    expect(toCodexPermissionRequest('0', method, MCP_TOOL_APPROVAL, undefined)).toEqual({
      type: 'permission_request',
      requestId: '0',
      name: 'Trigger URL Elicitation Tool',
      kind: 'other',
      title: 'Allow the everything MCP server to run tool "trigger-url-elicitation"?',
      input: {
        command:
          'message: Open this example URL to test URL elicitation.\nurl: https://example.com',
      },
      options: [
        { optionId: 'accept', name: 'Allow', kind: 'allow_once' },
        { optionId: 'acceptForSession', name: 'Allow for this session', kind: 'allow_always' },
        { optionId: 'cancel', name: 'Cancel', kind: 'reject_once' },
      ],
    });
  });

  it('answers as the elicitation action, persisting a session grant in _meta', () => {
    expect(toCodexApprovalResponse('accept', method, MCP_TOOL_APPROVAL)).toEqual({
      action: 'accept',
      content: null,
      _meta: null,
    });
    expect(toCodexApprovalResponse('acceptForSession', method, MCP_TOOL_APPROVAL)).toEqual({
      action: 'accept',
      content: null,
      _meta: { persist: 'session' },
    });
    expect(toCodexApprovalResponse('cancel', method, MCP_TOOL_APPROVAL)).toEqual({
      action: 'cancel',
      content: null,
      _meta: null,
    });
  });

  it('offers "always" only when the server does not offer "session"', () => {
    const alwaysOnly = {
      ...MCP_TOOL_APPROVAL,
      _meta: { codex_approval_kind: 'mcp_tool_call', persist: 'always' },
    };
    expect(
      toCodexPermissionRequest('0', method, alwaysOnly, undefined).options.map((o) => o.optionId)
    ).toEqual(['accept', 'acceptAlways', 'cancel']);
    expect(toCodexApprovalResponse('acceptAlways', method, alwaysOnly)).toEqual({
      action: 'accept',
      content: null,
      _meta: { persist: 'always' },
    });
    expect(() => toCodexApprovalResponse('acceptAlways', method, MCP_TOOL_APPROVAL)).toThrow();
  });
});

describe('a permissions request', () => {
  const method = PERMISSIONS_APPROVAL_METHOD;

  it('is a card naming the tool and what it asks for, with the agent’s reason', () => {
    expect(toCodexPermissionRequest('7', method, PERMISSIONS_APPROVAL, undefined)).toEqual({
      type: 'permission_request',
      requestId: '7',
      name: 'request_permissions',
      kind: 'other',
      title: 'May I access the network to fetch https://example.com?',
      input: { command: 'network access' },
      options: [
        { optionId: 'turn', name: 'Allow', kind: 'allow_once' },
        { optionId: 'session', name: 'Allow for this session', kind: 'allow_always' },
        { optionId: 'decline', name: 'Deny', kind: 'reject_once' },
      ],
    });
  });

  it('grants what was asked for the chosen scope, and nothing on deny', () => {
    expect(toCodexApprovalResponse('turn', method, PERMISSIONS_APPROVAL)).toEqual({
      permissions: { network: { enabled: true } },
      scope: 'turn',
    });
    expect(toCodexApprovalResponse('session', method, PERMISSIONS_APPROVAL)).toEqual({
      permissions: { network: { enabled: true } },
      scope: 'session',
    });
    expect(toCodexApprovalResponse('decline', method, PERMISSIONS_APPROVAL)).toEqual({
      permissions: {},
      scope: 'turn',
    });
    expect(() => toCodexApprovalResponse('always', method, PERMISSIONS_APPROVAL)).toThrow();
  });

  it('names file system access by path and mode', () => {
    const fileSystem = {
      ...PERMISSIONS_APPROVAL,
      reason: null,
      permissions: {
        network: null,
        fileSystem: { read: ['C:\\data'], write: ['C:\\out', 'C:\\logs'] },
      },
    };
    const card = toCodexPermissionRequest('8', method, fileSystem, undefined);
    expect(card.name).toBe('request_permissions');
    expect(card.title).toBe('Codex asks for more access than its sandbox allows.');
    expect(card.input).toEqual({ command: 'read C:\\data\nwrite C:\\out\nwrite C:\\logs' });
  });

  it('names a path once when Codex sends it as a legacy list and an entry', () => {
    const card = toCodexPermissionRequest('9', method, FILE_PERMISSIONS_APPROVAL, undefined);
    expect(card.input).toEqual({ command: 'write C:\\Users\\dev\\chord-perm-check' });
  });
});
