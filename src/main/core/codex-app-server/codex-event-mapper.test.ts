import { describe, expect, it } from 'vitest';
import { toCodexApprovalResponse, toCodexPermissionRequest } from './codex-approvals';
import {
  AGENT_MESSAGE_DELTA,
  AGENT_MESSAGE_STARTED,
  COMMAND_APPROVAL,
  COMMAND_COMPLETED,
  COMMAND_STARTED,
  FILE_CHANGE_APPROVAL,
  FILE_CHANGE_COMPLETED,
  FILE_CHANGE_STARTED,
  PLAN_COMPLETED,
  RATE_LIMITS_UPDATED,
  TOKEN_USAGE_UPDATED,
  TURN_COMPLETED,
} from './codex-captured-messages';
import { mapCodexNotification } from './codex-event-mapper';

const HELLO_PATH = 'C:\\Users\\dev\\AppData\\Local\\Temp\\codex-proto\\ws\\hello.txt';

describe('mapCodexNotification — messages', () => {
  it('opens a text block per agent message and streams its deltas', () => {
    expect(mapCodexNotification('item/started', AGENT_MESSAGE_STARTED)).toEqual([
      { type: 'text_block_start' },
    ]);
    expect(mapCodexNotification('item/agentMessage/delta', AGENT_MESSAGE_DELTA)).toEqual([
      { type: 'text', text: 'OK', messageId: AGENT_MESSAGE_DELTA.itemId },
    ]);
  });

  it('streams reasoning summary and reasoning text as reasoning', () => {
    const base = { threadId: 't', turnId: 'u', itemId: 'rs_1', delta: 'Checking the file' };
    expect(
      mapCodexNotification('item/reasoning/summaryTextDelta', { ...base, summaryIndex: 0 })
    ).toEqual([{ type: 'reasoning', text: 'Checking the file' }]);
    expect(mapCodexNotification('item/reasoning/textDelta', { ...base, contentIndex: 0 })).toEqual([
      { type: 'reasoning', text: 'Checking the file' },
    ]);
  });

  it('ignores items and notifications the chat does not render', () => {
    expect(
      mapCodexNotification('item/started', {
        ...AGENT_MESSAGE_STARTED,
        item: { type: 'userMessage', id: 'u1', clientId: null, content: [] },
      })
    ).toEqual([]);
    expect(mapCodexNotification('hook/started', { threadId: 't' })).toEqual([]);
  });
});

describe('mapCodexNotification — tools', () => {
  it('shows a shell command by what it runs, then its output', () => {
    expect(mapCodexNotification('item/started', COMMAND_STARTED)).toEqual([
      {
        type: 'tool_call',
        callId: 'exec-13fce3e4-9a29-4ea3-bc1a-baf63ccf5b8f',
        name: 'Shell',
        status: 'in_progress',
        kind: 'execute',
        title: 'echo hi',
        rawInput: { command: 'echo hi' },
      },
    ]);
    expect(mapCodexNotification('item/completed', COMMAND_COMPLETED)).toEqual([
      {
        type: 'tool_call_update',
        callId: 'exec-13fce3e4-9a29-4ea3-bc1a-baf63ccf5b8f',
        status: 'completed',
        content: [{ type: 'text', text: 'hi\r\n' }],
      },
    ]);
  });

  it('reports a declined command as failed', () => {
    const declined = {
      ...COMMAND_COMPLETED,
      item: { ...COMMAND_COMPLETED.item, status: 'declined', aggregatedOutput: null },
    };
    expect(mapCodexNotification('item/completed', declined)).toEqual([
      {
        type: 'tool_call_update',
        callId: 'exec-13fce3e4-9a29-4ea3-bc1a-baf63ccf5b8f',
        status: 'failed',
      },
    ]);
  });

  it('shows a file change with its path and diff', () => {
    expect(mapCodexNotification('item/started', FILE_CHANGE_STARTED)).toEqual([
      {
        type: 'tool_call',
        callId: 'exec-112528cc-2382-4d29-9cc0-88936617cb4e',
        name: 'Edit',
        status: 'in_progress',
        kind: 'edit',
        title: 'Create hello.txt',
        rawInput: { path: HELLO_PATH },
        locations: [{ filePath: HELLO_PATH }],
        content: [{ type: 'diff', diff: 'hi\n' }],
      },
    ]);
    expect(mapCodexNotification('item/completed', FILE_CHANGE_COMPLETED)).toEqual([
      {
        type: 'tool_call_update',
        callId: 'exec-112528cc-2382-4d29-9cc0-88936617cb4e',
        status: 'completed',
      },
    ]);
  });
});

describe('mapCodexNotification — plan, telemetry, turn', () => {
  it('turns a completed plan item into a plan for approval', () => {
    expect(mapCodexNotification('item/completed', PLAN_COMPLETED)).toEqual([
      {
        type: 'plan_request',
        requestId: '01a0cace-aee1-79a0-ad36-4cc51eb8fafc-plan',
        plan: '1. Create `hello.txt` in the workspace root containing `Hello, world!` followed by a newline.\n2. Verify the file exists and its contents match.\n',
        entries: [],
      },
    ]);
  });

  it('maps the turn plan checklist', () => {
    expect(
      mapCodexNotification('turn/plan/updated', {
        threadId: 't',
        turnId: 'u',
        explanation: null,
        plan: [
          { step: 'Create hello.txt', status: 'completed' },
          { step: 'Verify it', status: 'inProgress' },
          { step: 'Report back', status: 'pending' },
        ],
      })
    ).toEqual([
      {
        type: 'plan',
        entries: [
          { text: 'Create hello.txt', status: 'completed' },
          { text: 'Verify it', status: 'in_progress' },
          { text: 'Report back', status: 'pending' },
        ],
      },
    ]);
  });

  it('reports context fill from the last request against the model window', () => {
    expect(mapCodexNotification('thread/tokenUsage/updated', TOKEN_USAGE_UPDATED)).toEqual([
      { type: 'context_usage', usedTokens: 17628, maxTokens: 258400 },
    ]);
  });

  it('reports the 5-hour and weekly windows', () => {
    expect(mapCodexNotification('account/rateLimits/updated', RATE_LIMITS_UPDATED)).toEqual([
      {
        type: 'rate_limit',
        windows: [
          { id: 'five_hour', label: '5-hour limit', usedPercent: 0, resetsAt: 1790126936000 },
          { id: 'seven_day', label: 'Weekly limit', usedPercent: 26, resetsAt: 1790446123000 },
        ],
      },
    ]);
  });

  it('completes the turn with its id as the history ref, surfacing a failed turn as an error first', () => {
    // The turn id is where `thread/fork {lastTurnId}` can cut the thread (Reset, Fork).
    expect(mapCodexNotification('turn/completed', TURN_COMPLETED)).toEqual([
      { type: 'turn_completed', historyRef: '01a0cace-933e-7cb1-86fc-1644698c3c58' },
    ]);
    const failed = {
      ...TURN_COMPLETED,
      turn: {
        ...TURN_COMPLETED.turn,
        status: 'failed' as const,
        error: {
          message: 'stream disconnected before completion',
          codexErrorInfo: null,
          additionalDetails: null,
          misalignment: null,
        },
      },
    };
    // A failed turn is still in the thread, so it is still a point to fork at.
    expect(mapCodexNotification('turn/completed', failed)).toEqual([
      { type: 'error', message: 'stream disconnected before completion' },
      { type: 'turn_completed', historyRef: '01a0cace-933e-7cb1-86fc-1644698c3c58' },
    ]);
  });
});

describe('Codex approvals', () => {
  it('asks for a command with the decisions the server offers', () => {
    expect(
      toCodexPermissionRequest(
        '7',
        'item/commandExecution/requestApproval',
        COMMAND_APPROVAL,
        COMMAND_STARTED.item
      )
    ).toEqual({
      type: 'permission_request',
      requestId: '7',
      name: 'Shell',
      kind: 'execute',
      title: 'Run echo hi',
      input: { command: 'echo hi' },
      options: [
        { optionId: 'accept', name: 'Allow', kind: 'allow_once' },
        {
          optionId: 'acceptWithExecpolicyAmendment',
          name: 'Always allow this command',
          kind: 'allow_always',
        },
        { optionId: 'cancel', name: 'Decline and stop', kind: 'reject_always' },
      ],
    });
  });

  it('asks for a file change by the files its item touches', () => {
    expect(
      toCodexPermissionRequest(
        '8',
        'item/fileChange/requestApproval',
        FILE_CHANGE_APPROVAL,
        FILE_CHANGE_STARTED.item
      )
    ).toEqual({
      type: 'permission_request',
      requestId: '8',
      name: 'Edit',
      kind: 'edit',
      title: 'Create hello.txt',
      input: { path: HELLO_PATH },
      options: [
        { optionId: 'accept', name: 'Allow', kind: 'allow_once' },
        { optionId: 'acceptForSession', name: 'Allow for this session', kind: 'allow_always' },
        { optionId: 'decline', name: 'Decline', kind: 'reject_once' },
      ],
    });
  });

  it('answers a command with the offered decision, amendment included', () => {
    const method = 'item/commandExecution/requestApproval';
    expect(toCodexApprovalResponse('accept', method, COMMAND_APPROVAL)).toEqual({
      decision: 'accept',
    });
    expect(
      toCodexApprovalResponse('acceptWithExecpolicyAmendment', method, COMMAND_APPROVAL)
    ).toEqual({
      decision: { acceptWithExecpolicyAmendment: { execpolicy_amendment: ['echo', 'hi'] } },
    });
    // Not offered for this command, so not a valid answer.
    expect(() => toCodexApprovalResponse('decline', method, COMMAND_APPROVAL)).toThrow();
  });

  it('answers a file change with one of its fixed decisions', () => {
    const method = 'item/fileChange/requestApproval';
    expect(toCodexApprovalResponse('acceptForSession', method, FILE_CHANGE_APPROVAL)).toEqual({
      decision: 'acceptForSession',
    });
    expect(toCodexApprovalResponse('decline', method, FILE_CHANGE_APPROVAL)).toEqual({
      decision: 'decline',
    });
    expect(() => toCodexApprovalResponse('allow', method, FILE_CHANGE_APPROVAL)).toThrow();
  });
});
