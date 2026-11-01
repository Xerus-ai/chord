import { describe, expect, it } from 'vitest';
import type { StreamItem, ToolCallItem } from '@shared/stream-items';
import type { Thread } from '@main/core/codex-app-server/protocol/v2/Thread';
import type { Turn } from '@main/core/codex-app-server/protocol/v2/Turn';
import type { AgentPathEnvironment } from '@main/utils/agent-reported-path';
import {
  buildCodexImportMessages,
  buildCodexThreadListParams,
  buildCodexTurnsPageParams,
  selectImportableCodexThreads,
} from './codex-history';
import type { ImportedMessage } from './transcript-builder';

/**
 * A Codex thread's turns into Chord chat rows, and which threads a lane
 * offers. The two turns below are the thread spike S5 started outside Chord
 * with `codex exec` and continued over the app-server, exactly as
 * `thread/read includeTurns` returned them from codex-cli 0.154.0
 * (`chord-lane-checks/probe-s5/dumps/40-read-after.json`).
 */
const CWD = 'C:\\Users\\dev\\chord-lane-checks\\probe-s5\\ext-repo';
const HELLO = `${CWD}\\hello.txt`;
// The spike ran on Windows: its paths are read as that platform's, whatever
// host runs the suite.
const WINDOWS: AgentPathEnvironment = {
  platform: 'win32',
  tempDir: 'C:\\Users\\dev\\AppData\\Local\\Temp',
};

const S5_TURNS: Turn[] = [
  {
    id: '01a10269-dc01-7b30-ad21-f4e565bbee03',
    items: [
      {
        type: 'userMessage',
        id: '01a10269-e805-7800-ae1d-c53a9c5d80ed',
        clientId: null,
        content: [
          {
            type: 'text',
            text: "Run the shell command 'git status --short' once, then create a file named hello.txt containing exactly the text 'hi from exec'. Do nothing else. Reply with one short sentence.",
            text_elements: [],
          },
        ],
      },
      {
        type: 'agentMessage',
        id: 'msg_09d66726f075791b016ac12146c37c87d08237e2b424efcae1',
        text: 'I’ll run the command once and create hello.txt with the exact text.\n',
        phase: 'commentary',
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
      {
        type: 'commandExecution',
        id: 'exec-9419ae8f-9363-496e-9e4a-1aa4d6d98ff7',
        pluginId: null,
        scriptPath: null,
        command:
          '"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe" -Command \'git status --short\'',
        cwd: CWD,
        processId: '54876',
        source: 'unifiedExecStartup',
        status: 'completed',
        commandActions: [{ type: 'unknown', command: 'git status --short' }],
        aggregatedOutput: null,
        exitCode: 0,
        durationMs: 116,
      },
      {
        type: 'commandExecution',
        id: 'exec-2bad4391-56cd-4b9a-b658-caa6c39c9f2d',
        pluginId: null,
        scriptPath: null,
        command:
          "\"C:\\\\Windows\\\\System32\\\\WindowsPowerShell\\\\v1.0\\\\powershell.exe\" -Command \"[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'hello.txt'), 'hi from exec', [System.Text.UTF8Encoding]::new(\"'$false))'",
        cwd: CWD,
        processId: '87452',
        source: 'unifiedExecStartup',
        status: 'completed',
        commandActions: [
          {
            type: 'unknown',
            command:
              "[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'hello.txt'), 'hi from exec', [System.Text.UTF8Encoding]::new($false))",
          },
        ],
        aggregatedOutput: null,
        exitCode: 0,
        durationMs: 113,
      },
      {
        type: 'agentMessage',
        id: 'msg_09d66726f075791b016ac1214f140c87d081dba58fe7196fc6',
        text: 'Ran `git status --short` once and created `hello.txt` containing exactly `hi from exec`.',
        phase: 'final_answer',
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
    ],
    itemsView: 'full',
    status: 'completed',
    error: null,
    startedAt: 1791041854,
    completedAt: 1791041871,
    durationMs: 17223,
  },
  {
    id: '01a1026a-de17-7bc2-8c89-be0e95b1ebba',
    items: [
      {
        type: 'userMessage',
        id: '01a1026a-e7ba-7b01-ac92-9bda582df51d',
        clientId: null,
        content: [
          {
            type: 'text',
            text: 'What exact text did you write into hello.txt earlier in this conversation? Answer in one sentence, then use apply_patch to append a second line "hi from chord" to hello.txt. Do nothing else.',
            text_elements: [],
          },
        ],
      },
      {
        type: 'agentMessage',
        id: 'msg_01986b65a78628d2016ac12186e31887d084a0c8b7c46a265e',
        text: 'I wrote exactly “hi from exec” into hello.txt.\n',
        phase: 'commentary',
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
      {
        type: 'fileChange',
        id: 'exec-8fdd9458-af23-4d5f-aae4-b01facdba46f',
        changes: [
          {
            path: HELLO,
            kind: { type: 'update', move_path: null },
            diff: '@@ -1 +1,2 @@\n-hi from exec\n\\ No newline at end of file\n+hi from exec\n+hi from chord\n',
          },
        ],
        status: 'completed',
      },
      {
        type: 'agentMessage',
        id: 'msg_01986b65a78628d2016ac1218d11f087d097122ca7df78afc8',
        text: '',
        phase: 'final_answer',
        memoryCitation: null,
        delivery: null,
        questions: null,
      },
    ],
    itemsView: 'full',
    status: 'completed',
    error: null,
    startedAt: 1791041920,
    completedAt: 1791041932,
    durationMs: 12115,
  },
];

function agentTurns(messages: ImportedMessage[]) {
  return messages.flatMap((m) => (m.kind === 'agent_turn' ? [m] : []));
}

function tools(items: StreamItem[]): ToolCallItem[] {
  return items.flatMap((item) => (item.kind === 'tool_group' ? item.tools : []));
}

describe('buildCodexImportMessages', () => {
  it('turns the spike thread into prompts and replies, in order, at the turn times', () => {
    const messages = buildCodexImportMessages(S5_TURNS, CWD, WINDOWS);

    expect(messages.map((m) => m.kind)).toEqual(['human', 'agent_turn', 'human', 'agent_turn']);
    expect(messages[0]).toEqual({
      kind: 'human',
      content:
        "Run the shell command 'git status --short' once, then create a file named hello.txt containing exactly the text 'hi from exec'. Do nothing else. Reply with one short sentence.",
      createdAt: 1791041854_000,
    });
    const [first, second] = agentTurns(messages);
    expect(first.startedAt).toBe(1791041854_000);
    expect(first.completedAt).toBe(1791041871_000);
    expect(second.completedAt).toBe(1791041932_000);
  });

  it('shows shell commands as the live chat does: the parsed command, not the PowerShell wrapper', () => {
    const [first] = agentTurns(buildCodexImportMessages(S5_TURNS, CWD, WINDOWS));
    expect(first.items.map((i) => i.kind)).toEqual(['text', 'tool_group', 'text']);
    expect(tools(first.items)).toEqual([
      {
        callId: 'exec-9419ae8f-9363-496e-9e4a-1aa4d6d98ff7',
        name: 'Shell',
        status: 'completed',
        kind: 'execute',
        rawInput: { command: 'git status --short' },
      },
      {
        callId: 'exec-2bad4391-56cd-4b9a-b658-caa6c39c9f2d',
        name: 'Shell',
        status: 'completed',
        kind: 'execute',
        rawInput: {
          command:
            "[System.IO.File]::WriteAllText((Join-Path (Get-Location) 'hello.txt'), 'hi from exec', [System.Text.UTF8Encoding]::new($false))",
        },
      },
    ]);
  });

  it('shows a file change as an Edit with its diff, and lists the file the turn changed', () => {
    const [, second] = agentTurns(buildCodexImportMessages(S5_TURNS, CWD, WINDOWS));
    // The empty final agent message adds nothing.
    expect(second.items.map((i) => i.kind)).toEqual(['text', 'tool_group', 'file_changes']);
    expect(tools(second.items)[0]).toEqual({
      callId: 'exec-8fdd9458-af23-4d5f-aae4-b01facdba46f',
      name: 'Edit',
      status: 'completed',
      kind: 'edit',
      rawInput: { path: HELLO },
      locations: [{ filePath: HELLO }],
      contentBlocks: [
        {
          type: 'diff',
          diff: '@@ -1 +1,2 @@\n-hi from exec\n\\ No newline at end of file\n+hi from exec\n+hi from chord\n',
        },
      ],
    });
    expect(second.items[2]).toEqual({
      kind: 'file_changes',
      id: expect.any(String),
      files: [{ name: 'hello.txt', filePath: HELLO, added: 2, removed: 1 }],
    });
  });

  it('carries a failed command with its output, reasoning as thinking, and a failed turn as an error', () => {
    const turn: Turn = {
      id: 'turn-failed',
      items: [
        {
          type: 'userMessage',
          id: 'u1',
          clientId: null,
          content: [
            { type: 'text', text: 'Run the tests.', text_elements: [] },
            { type: 'localImage', path: 'C:\\shots\\failing.png' },
          ],
        },
        { type: 'reasoning', id: 'r1', summary: ['The suite is vitest.'], content: [] },
        {
          type: 'commandExecution',
          id: 'c1',
          pluginId: null,
          scriptPath: null,
          command: 'pnpm test',
          cwd: CWD,
          processId: null,
          source: 'agent',
          status: 'failed',
          commandActions: [],
          aggregatedOutput: '2 failed, 40 passed',
          exitCode: 1,
          durationMs: 4000,
        },
      ],
      itemsView: 'full',
      status: 'failed',
      error: {
        message: 'stream disconnected before completion',
        codexErrorInfo: null,
        additionalDetails: null,
        misalignment: null,
      },
      startedAt: 1791050000,
      completedAt: 1791050010,
      durationMs: 10000,
    };
    const messages = buildCodexImportMessages([turn], CWD, WINDOWS);

    expect(messages[0]).toMatchObject({ kind: 'human', content: 'Run the tests.\n\n[image]' });
    const [reply] = agentTurns(messages);
    expect(reply.items.map((i) => i.kind)).toEqual(['thinking', 'tool_group', 'error']);
    expect(reply.items[0]).toMatchObject({ text: 'The suite is vitest.', status: 'ready' });
    expect(tools(reply.items)[0]).toMatchObject({
      name: 'Shell',
      status: 'failed',
      rawInput: { command: 'pnpm test' },
      contentBlocks: [{ type: 'text', text: '2 failed, 40 passed' }],
    });
    expect(reply.items[2]).toMatchObject({ message: 'stream disconnected before completion' });
  });
});

describe('buildCodexThreadListParams', () => {
  it('asks for every source a user starts a thread from, exec included, filtered to the lane', () => {
    // Without `sourceKinds` the app-server returns only cli and vscode threads,
    // so a thread from `codex exec` never showed up (spike S5, dump 02 vs 04).
    const params = buildCodexThreadListParams(CWD, null);
    expect(params.cwd).toBe(CWD);
    expect(params.sourceKinds).toEqual(
      expect.arrayContaining(['cli', 'vscode', 'exec', 'appServer'])
    );
    expect(params.sourceKinds).not.toContain('subAgent');
    expect(params.cursor).toBeNull();
    expect(params.archived).toBe(false);
  });

  it('passes the cursor for the next page', () => {
    expect(buildCodexThreadListParams(CWD, '2026-09-27T00:55:15Z').cursor).toBe(
      '2026-09-27T00:55:15Z'
    );
  });
});

describe('buildCodexTurnsPageParams', () => {
  it('pages the full items oldest first — the default summary view drops command executions', () => {
    expect(buildCodexTurnsPageParams('thread-1', null)).toEqual({
      threadId: 'thread-1',
      cursor: null,
      itemsView: 'full',
      sortDirection: 'asc',
    });
  });
});

describe('selectImportableCodexThreads', () => {
  /** The S5 thread's metadata as `thread/list` returned it (dump 04). */
  function thread(overrides: Partial<Thread>): Thread {
    return {
      id: '01a10269-db68-76d3-9baf-854c0db61cf8',
      environments: [{ environmentId: 'local', cwd: CWD, runtimeWorkspaceRoots: [CWD] }],
      extra: null,
      sessionId: '01a10269-db68-76d3-9baf-854c0db61cf8',
      forkedFromId: null,
      parentThreadId: null,
      preview: "Run the shell command 'git status --short' once",
      ephemeral: false,
      section: null,
      sectionEnteredAt: null,
      projectId: null,
      historyMode: 'paginated',
      modelProvider: 'openai',
      model: 'gpt-6-astra',
      reasoningEffort: 'low',
      createdAt: 1791041854,
      updatedAt: 1791041932,
      recencyAt: 1791041920,
      status: { type: 'idle' },
      path: 'C:\\Users\\dev\\AppData\\Roaming\\other-app\\codex-runtime-home\\home\\sessions\\2026\\10\\03\\rollout-2026-10-03T21-07-34-01a10269-db68-76d3-9baf-854c0db61cf8.jsonl',
      cwd: CWD,
      cliVersion: '0.154.0',
      originator: 'codex_exec',
      source: 'exec',
      canAcceptDirectInput: true,
      threadSource: 'user',
      agentNickname: null,
      agentRole: null,
      gitInfo: null,
      name: null,
      daybreakEnabled: null,
      turns: [],
      ...overrides,
    };
  }

  it('offers a thread started outside Chord, titled by its name, else its first prompt', () => {
    const sessions = selectImportableCodexThreads(
      [thread({}), thread({ id: 'named', name: 'Ledger fix' })],
      CWD,
      new Set()
    );
    expect(sessions).toEqual([
      {
        providerId: 'codex',
        providerSessionId: '01a10269-db68-76d3-9baf-854c0db61cf8',
        title: "Run the shell command 'git status --short' once",
        lastActivityAt: 1791041932_000,
        cwd: CWD,
      },
      expect.objectContaining({ providerSessionId: 'named', title: 'Ledger fix' }),
    ]);
  });

  it("leaves out Chord's own threads — by originator, since they report source vscode", () => {
    const sessions = selectImportableCodexThreads(
      [thread({ id: 'mine', originator: 'chord', source: 'vscode' })],
      CWD,
      new Set()
    );
    expect(sessions).toEqual([]);
  });

  it('leaves out threads Chord already imported, and spawned subagent threads', () => {
    const sessions = selectImportableCodexThreads(
      [thread({ id: 'imported' }), thread({ id: 'child', parentThreadId: 'imported' })],
      CWD,
      new Set(['imported'])
    );
    expect(sessions).toEqual([]);
  });
});
