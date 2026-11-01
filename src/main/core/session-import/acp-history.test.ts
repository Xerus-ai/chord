import type { InitializeResponse, SessionInfo, SessionUpdate } from '@agentclientprotocol/sdk';
import { describe, expect, it } from 'vitest';
import type { StreamItem, ToolCallItem } from '@shared/stream-items';
import type { AgentPathEnvironment } from '@main/utils/agent-reported-path';
import {
  buildAcpImportMessages,
  describeAcpSessionSupport,
  selectImportableAcpSessions,
} from './acp-history';

/**
 * An ACP agent's `session/load` replay into Chord chat rows, and what an
 * agent's `initialize` says it can do. The replays and capabilities below are
 * what opencode 1.18.32 and claude-agent-acp 0.33.1 sent in spike S6
 * (`chord-lane-checks/probe-s6/acp-probe*.out.txt`); tool calls use the ACP
 * 1.1.0 schema shapes (`ToolCall`, `ToolCallUpdate`, `ToolCallContent`).
 */
const LANE = 'C:\\Users\\dev\\chord\\worktrees\\ledger\\raghav-ledger';
const AT = Date.parse('2026-10-03T15:41:07.699Z');
// The spike ran on Windows: its paths are read as that platform's, whatever
// host runs the suite.
const WINDOWS: AgentPathEnvironment = {
  platform: 'win32',
  tempDir: 'C:\\Users\\dev\\AppData\\Local\\Temp',
};

function tools(items: StreamItem[]): ToolCallItem[] {
  return items.flatMap((item) => (item.kind === 'tool_group' ? item.tools : []));
}

describe('buildAcpImportMessages', () => {
  it("replays claude-agent-acp's PELICAN session as two prompts and two replies", () => {
    const replay: SessionUpdate[] = [
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'text', text: 'Remember the word PELICAN. Reply with just: ok' },
      },
      { sessionUpdate: 'agent_thought_chunk', content: { type: 'text', text: '' } },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'ok' } },
      {
        sessionUpdate: 'user_message_chunk',
        content: {
          type: 'text',
          text: 'What word did I ask you to remember? Reply with just the word.',
        },
      },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'PELICAN' } },
      { sessionUpdate: 'available_commands_update', availableCommands: [] },
    ];
    const messages = buildAcpImportMessages(replay, AT, LANE, WINDOWS);

    // A replay carries no times: rows count back from the session's last
    // activity a second apart, so the chat orders them as they were replayed
    // (prompt, reply, prompt, reply) and the last row is the last activity.
    expect(messages).toEqual([
      {
        kind: 'human',
        content: 'Remember the word PELICAN. Reply with just: ok',
        createdAt: AT - 3000,
      },
      {
        kind: 'agent_turn',
        items: [{ kind: 'text', id: expect.any(String), text: 'ok' }],
        startedAt: AT - 2000,
        completedAt: AT - 2000,
      },
      {
        kind: 'human',
        content: 'What word did I ask you to remember? Reply with just the word.',
        createdAt: AT - 1000,
      },
      {
        kind: 'agent_turn',
        items: [{ kind: 'text', id: expect.any(String), text: 'PELICAN' }],
        startedAt: AT,
        completedAt: AT,
      },
    ]);
  });

  it("replays opencode's session: one prompt, its thinking and its reply", () => {
    const replay: SessionUpdate[] = [
      {
        sessionUpdate: 'user_message_chunk',
        messageId: 'msg_0cff47447001VP7Wf8tDPWd6Zs',
        content: { type: 'text', text: 'Without using tools, reply with the single word BACK.' },
      },
      {
        sessionUpdate: 'agent_thought_chunk',
        messageId: 'prt_0cff48104001nQtSAlmnvMw3rR',
        content: {
          type: 'text',
          text: 'The user says "Without using tools, reply with the single word BACK."\n\nI should just reply with the single word BACK.',
        },
      },
      {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'msg_0cff47467001w61cZNiYDpWYe5',
        content: { type: 'text', text: 'BACK' },
      },
    ];
    const [prompt, reply] = buildAcpImportMessages(replay, AT, LANE, WINDOWS);

    expect(prompt).toEqual({
      kind: 'human',
      content: 'Without using tools, reply with the single word BACK.',
      createdAt: AT - 1000,
    });
    expect(reply).toMatchObject({ startedAt: AT, completedAt: AT });
    if (reply.kind !== 'agent_turn') throw new Error('expected an agent turn');
    expect(reply.items.map((i) => i.kind)).toEqual(['thinking', 'text']);
    expect(reply.items[0]).toMatchObject({ status: 'ready' });
  });

  it('joins a prompt and a reply streamed in chunks, and breaks paragraphs between messages', () => {
    const replay: SessionUpdate[] = [
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Fix the ' } },
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'flaky test.' } },
      {
        sessionUpdate: 'user_message_chunk',
        content: { type: 'image', data: 'iVBORw0KGgoAAAA', mimeType: 'image/png' },
      },
      {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: 'Looking ' },
      },
      {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm1',
        content: { type: 'text', text: 'now.' },
      },
      {
        sessionUpdate: 'agent_message_chunk',
        messageId: 'm2',
        content: { type: 'text', text: 'Fixed.' },
      },
    ];
    const [prompt, reply] = buildAcpImportMessages(replay, AT, LANE, WINDOWS);

    expect(prompt).toMatchObject({ kind: 'human', content: 'Fix the flaky test.\n\n[image]' });
    if (reply.kind !== 'agent_turn') throw new Error('expected an agent turn');
    expect(reply.items).toEqual([
      { kind: 'text', id: expect.any(String), text: 'Looking now.\n\nFixed.' },
    ]);
    expect(JSON.stringify([prompt, reply])).not.toContain('iVBORw0KGgo');
  });

  it('settles tool calls from their updates, with text output and diffs', () => {
    const file = `${LANE}\\src\\ledger.ts`;
    const replay: SessionUpdate[] = [
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Rename the job.' } },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_read',
        title: 'Read src/ledger.ts',
        kind: 'read',
        status: 'pending',
        rawInput: { filePath: file },
        locations: [{ path: file, line: 3 }],
      },
      {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'call_read',
        status: 'completed',
        content: [{ type: 'content', content: { type: 'text', text: 'export const job = 1;' } }],
      },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'call_edit',
        title: 'Edit src/ledger.ts',
        kind: 'edit',
        status: 'in_progress',
        locations: [{ path: file }],
        content: [
          {
            type: 'diff',
            path: file,
            oldText: 'export const job = 1;',
            newText: 'export const ledgerJob = 1;',
          },
        ],
      },
      { sessionUpdate: 'tool_call_update', toolCallId: 'call_edit', status: 'completed' },
      { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Renamed.' } },
    ];
    const [, reply] = buildAcpImportMessages(replay, AT, LANE, WINDOWS);
    if (reply.kind !== 'agent_turn') throw new Error('expected an agent turn');

    const calls = tools(reply.items);
    expect(calls[0]).toEqual({
      callId: 'call_read',
      name: 'Read src/ledger.ts',
      status: 'completed',
      kind: 'read',
      rawInput: { filePath: file },
      locations: [{ filePath: file, startLine: 3 }],
      contentBlocks: [{ type: 'text', text: 'export const job = 1;' }],
    });
    expect(calls[1]).toMatchObject({
      callId: 'call_edit',
      kind: 'edit',
      status: 'completed',
      contentBlocks: [
        {
          type: 'diff',
          diff: `--- ${file}\n+++ ${file}\n-export const job = 1;\n+export const ledgerJob = 1;`,
        },
      ],
    });
    expect(reply.items.map((i) => i.kind)).toEqual(['tool_group', 'text', 'file_changes']);
    expect(reply.items[2]).toMatchObject({
      files: [{ name: 'ledger.ts', filePath: file, added: 1, removed: 1 }],
    });
  });

  it('names an unrecognised tool kind the way the live ACP path does', () => {
    const replay: SessionUpdate[] = [
      { sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'go' } },
      {
        sessionUpdate: 'tool_call',
        toolCallId: 'c1',
        title: 'bash',
        kind: 'other',
        status: 'completed',
      },
    ];
    const [, reply] = buildAcpImportMessages(replay, AT, LANE, WINDOWS);
    if (reply.kind !== 'agent_turn') throw new Error('expected an agent turn');
    expect(tools(reply.items)[0]).toMatchObject({ name: 'bash', kind: 'execute' });
  });
});

describe('describeAcpSessionSupport', () => {
  it('opencode lists, loads, and resumes without a replay', () => {
    const opencode = {
      protocolVersion: 1,
      agentCapabilities: {
        loadSession: true,
        mcpCapabilities: { http: true, sse: true },
        promptCapabilities: { embeddedContext: true, image: true },
        sessionCapabilities: { close: {}, fork: {}, list: {}, resume: {} },
      },
      authMethods: [],
      agentInfo: { name: 'OpenCode', version: '1.18.32' },
    } satisfies InitializeResponse;
    expect(describeAcpSessionSupport(opencode)).toEqual({
      canList: true,
      canLoad: true,
      continueWith: 'session/resume',
    });
  });

  it('an agent that loads but cannot resume continues through session/load', () => {
    expect(
      describeAcpSessionSupport({
        protocolVersion: 1,
        agentCapabilities: { loadSession: true, sessionCapabilities: { list: {} } },
      })
    ).toEqual({ canList: true, canLoad: true, continueWith: 'session/load' });
  });

  it('an agent that advertises neither can do nothing with outside sessions', () => {
    expect(describeAcpSessionSupport({ protocolVersion: 1, agentCapabilities: {} })).toEqual({
      canList: false,
      canLoad: false,
      continueWith: null,
    });
    expect(describeAcpSessionSupport({ protocolVersion: 1 })).toEqual({
      canList: false,
      canLoad: false,
      continueWith: null,
    });
  });
});

describe('selectImportableAcpSessions', () => {
  const sessions: SessionInfo[] = [
    {
      sessionId: 'ses_f300b8cf2ffee3Jrqdv8Tu8bxf',
      cwd: LANE,
      title: 'Permission check reply BACK',
      updatedAt: '2026-09-23T20:28:22.833Z',
    },
    {
      sessionId: 'ses_owned',
      cwd: LANE,
      title: 'A Chord chat',
      updatedAt: '2026-09-23T18:00:00.000Z',
    },
    {
      sessionId: 'ses_elsewhere',
      cwd: 'C:\\Users\\dev\\AppData\\Local\\Temp',
      title: 'New session',
    },
    { sessionId: 'ses_untitled', cwd: LANE.toLowerCase().replace(/\\/g, '/') },
  ];

  it("offers the lane's sessions Chord does not own, with title and last activity", () => {
    const offered = selectImportableAcpSessions(
      'opencode',
      sessions,
      LANE,
      new Set(['ses_owned']),
      'win32'
    );
    expect(offered).toEqual([
      {
        providerId: 'opencode',
        providerSessionId: 'ses_f300b8cf2ffee3Jrqdv8Tu8bxf',
        title: 'Permission check reply BACK',
        lastActivityAt: Date.parse('2026-09-23T20:28:22.833Z'),
        cwd: LANE,
      },
      // Same folder written another way (case, separators) is the same lane;
      // a session the agent gave no title or time keeps them null.
      {
        providerId: 'opencode',
        providerSessionId: 'ses_untitled',
        title: null,
        lastActivityAt: null,
        cwd: LANE,
      },
    ]);
  });
});
