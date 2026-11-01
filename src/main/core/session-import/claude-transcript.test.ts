import { randomUUID } from 'node:crypto';
import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { StreamItem, ToolCallItem } from '@shared/stream-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import {
  ClaudeTranscriptWriter,
  image,
  text,
  thinking,
  toolUse,
  writeSubagent,
  writeTranscript,
} from './_testing/claude-records';
import { readClaudeTranscript } from './claude-transcript';
import type { ImportedMessage } from './transcript-builder';

/**
 * A Claude Code transcript read from disk into Chord chat rows. Every file
 * here is written in the record shapes real transcripts have (see
 * `_testing/claude-records.ts`); what is under test is which records make the
 * conversation, and what each becomes.
 */
const root = realpathSync(mkdtempSync(join(tmpdir(), 'chord-claude-transcript-')));
const lane = join(root, 'lane');
const projectDir = join(root, 'project');
afterAll(() => removeDirSync(root));

const T0 = Date.parse('2026-09-24T11:50:00.000Z');

function newWriter(sessionId = randomUUID()) {
  return { sessionId, writer: new ClaudeTranscriptWriter({ sessionId, cwd: lane, startAt: T0 }) };
}

async function readBack(sessionId: string, writer: ClaudeTranscriptWriter) {
  return readClaudeTranscript(writeTranscript(projectDir, sessionId, writer), lane);
}

function humans(messages: ImportedMessage[]): string[] {
  return messages.flatMap((m) => (m.kind === 'human' ? [m.content] : []));
}

function agentItems(messages: ImportedMessage[]): StreamItem[][] {
  return messages.flatMap((m) => (m.kind === 'agent_turn' ? [m.items] : []));
}

function tools(items: StreamItem[]): ToolCallItem[] {
  return items.flatMap((item) => (item.kind === 'tool_group' ? item.tools : []));
}

function texts(items: StreamItem[]): string[] {
  return items.flatMap((item) => (item.kind === 'text' ? [item.text] : []));
}

describe('readClaudeTranscript', () => {
  it('turns a prompt and its reply — thinking, text, a tool call and its result — into rows', async () => {
    const { sessionId, writer } = newWriter();
    writer.meta({ type: 'mode', mode: 'normal' });
    writer.meta({ type: 'permission-mode', permissionMode: 'default' });
    writer.attachment();
    const promptAt = writer.nextAt;
    writer.prompt('How many files are in src?');
    const [, , bash] = writer.assistant([
      thinking('Counting with ls is enough.'),
      text('Counting them.'),
      toolUse('toolu_01Count', 'Bash', { command: 'ls src | wc -l', description: 'Count files' }),
    ]);
    writer.toolResult(bash, 'toolu_01Count', '42', {
      toolUseResult: { stdout: '42', stderr: '', interrupted: false, isImage: false },
    });
    const lastAt = writer.nextAt;
    writer.assistant([text('There are 42 files in src.')]);
    writer.system('stop_hook_summary', { hookCount: 1, hookInfos: [], hookErrors: [] });
    writer.system('turn_duration', { durationMs: 9000, messageCount: 5 });
    writer.meta({ type: 'ai-title', aiTitle: 'Count source files' });
    writer.meta({ type: 'last-prompt', lastPrompt: 'How many files are in src?' });
    writer.meta({ type: 'file-history-snapshot', messageId: randomUUID(), snapshot: {} });

    const messages = await readBack(sessionId, writer);

    expect(messages.map((m) => m.kind)).toEqual(['human', 'agent_turn']);
    expect(messages[0]).toEqual({
      kind: 'human',
      content: 'How many files are in src?',
      createdAt: promptAt,
    });
    const turn = messages[1];
    if (turn.kind !== 'agent_turn') throw new Error('expected an agent turn');
    expect(turn.completedAt).toBe(lastAt);
    expect(turn.items).toEqual([
      expect.objectContaining({
        kind: 'thinking',
        text: 'Counting with ls is enough.',
        status: 'ready',
      }),
      expect.objectContaining({ kind: 'text', text: 'Counting them.' }),
      {
        kind: 'tool_group',
        id: expect.any(String),
        tools: [
          {
            callId: 'toolu_01Count',
            name: 'Bash',
            status: 'completed',
            kind: 'execute',
            rawInput: { command: 'ls src | wc -l', description: 'Count files' },
            contentBlocks: [{ type: 'text', text: '42' }],
          },
        ],
      },
      expect.objectContaining({ kind: 'text', text: 'There are 42 files in src.' }),
    ]);
  });

  it('names tool kinds the way the live chat does', async () => {
    const { sessionId, writer } = newWriter();
    writer.prompt('look');
    const [read, edit, grep] = writer.assistant([
      toolUse('t-read', 'Read', { file_path: join(lane, 'a.ts') }),
      toolUse('t-edit', 'Edit', {
        file_path: join(lane, 'a.ts'),
        old_string: 'a',
        new_string: 'b',
      }),
      toolUse('t-grep', 'Grep', { pattern: 'TODO' }),
    ]);
    writer.toolResult(read, 't-read', 'const a = 1;');
    writer.toolResult(edit, 't-edit', 'The file has been updated.');
    writer.toolResult(grep, 't-grep', 'No matches');

    const [items] = agentItems(await readBack(sessionId, writer));
    expect(tools(items).map((t) => [t.name, t.kind, t.status])).toEqual([
      ['Read', 'read', 'completed'],
      ['Edit', 'edit', 'completed'],
      ['Grep', 'search', 'completed'],
    ]);
  });

  it('marks a tool result Claude flagged as an error as failed', async () => {
    const { sessionId, writer } = newWriter();
    writer.prompt('build it');
    const [bash] = writer.assistant([toolUse('t-build', 'Bash', { command: 'pnpm build' })]);
    writer.toolResult(bash, 't-build', 'Exit code 2\nerror TS2304', {
      isError: true,
      toolUseResult: 'Error: Exit code 2\nerror TS2304',
    });
    const [items] = agentItems(await readBack(sessionId, writer));
    expect(tools(items)[0]).toMatchObject({
      status: 'failed',
      contentBlocks: [{ type: 'text', text: 'Exit code 2\nerror TS2304' }],
    });
  });

  it('shows no thinking for the redacted (empty) thinking blocks recent transcripts carry', async () => {
    const { sessionId, writer } = newWriter();
    writer.prompt('hi');
    writer.assistant([thinking(''), text('Hello.')]);
    const [items] = agentItems(await readBack(sessionId, writer));
    expect(items.map((i) => i.kind)).toEqual(['text']);
  });

  it('keeps the history from before a compaction, and not the compaction summary', async () => {
    const { sessionId, writer } = newWriter();
    writer.prompt('First, read the plan.');
    writer.assistant([text('Read it: three phases.')]);
    writer.prompt('Start phase one.');
    writer.assistant([text('Phase one is done.')]);
    writer.compact('1. The user asked to read the plan and start phase one.');
    writer.prompt('Now phase two.');
    writer.assistant([text('Phase two is done.')]);

    const messages = await readBack(sessionId, writer);
    expect(humans(messages)).toEqual([
      'First, read the plan.',
      'Start phase one.',
      'Now phase two.',
    ]);
    expect(agentItems(messages).map(texts)).toEqual([
      ['Read it: three phases.'],
      ['Phase one is done.'],
      ['Phase two is done.'],
    ]);
  });

  it('leaves out a branch the user rewound away from', async () => {
    const { sessionId, writer } = newWriter();
    writer.prompt('Pick a name for the module.');
    const [kept] = writer.assistant([text('How about ledger-sync?')]);
    writer.prompt('Make it shorter.');
    writer.assistant([text('lsync')]);
    // Rewound to before "Make it shorter." and asked something else.
    writer.continueFrom(kept);
    writer.prompt('Use ledger-sync then.');
    writer.assistant([text('Done: ledger-sync.')]);

    const messages = await readBack(sessionId, writer);
    expect(humans(messages)).toEqual(['Pick a name for the module.', 'Use ledger-sync then.']);
    expect(JSON.stringify(messages)).not.toContain('lsync');
  });

  it('keeps every call of a parallel tool use and every result, though they fork the chain', async () => {
    const { sessionId, writer } = newWriter();
    writer.prompt('Read both files.');
    const [, first, second] = writer.assistant([
      text('Reading both.'),
      toolUse('t-a', 'Read', { file_path: join(lane, 'a.ts') }),
      toolUse('t-b', 'Read', { file_path: join(lane, 'b.ts') }),
    ]);
    const resultA = writer.toolResult(first, 't-a', 'export const a = 1;');
    writer.toolResult(second, 't-b', 'export const b = 2;');
    writer.continueFrom(resultA);
    writer.assistant([text('Both read.')]);

    const [items] = agentItems(await readBack(sessionId, writer));
    expect(tools(items).map((t) => [t.callId, t.status, t.contentBlocks?.[0]?.text])).toEqual([
      ['t-a', 'completed', 'export const a = 1;'],
      ['t-b', 'completed', 'export const b = 2;'],
    ]);
    expect(texts(items)).toEqual(['Reading both.', 'Both read.']);
  });

  it('records an image as a visible [image] marker, in a prompt and in a tool result', async () => {
    const png = 'iVBORw0KGgoAAAANSUhEUgAABXgAAABDCAYAAAAmjm3' + 'A'.repeat(4000);
    const { sessionId, writer } = newWriter();
    writer.prompt([text('What is wrong with this screen?'), image(png), image(png)]);
    const [shot] = writer.assistant([toolUse('t-shot', 'mcp__circuit-electron__screenshot', {})]);
    writer.toolResult(shot, 't-shot', [image(png)], {
      toolUseResult: { type: 'image', file: { type: 'image/png', originalSize: 67564 } },
    });
    writer.assistant([text('The button is clipped.')]);

    const messages = await readBack(sessionId, writer);
    expect(humans(messages)).toEqual(['What is wrong with this screen?\n\n[image]\n\n[image]']);
    expect(tools(agentItems(messages)[0])[0].contentBlocks).toEqual([
      { type: 'text', text: '[image]' },
    ]);
    expect(JSON.stringify(messages)).not.toContain('iVBORw0KGgo');
  });

  it('keeps an output Claude Code saved to tool-results/ as the preview the transcript holds', async () => {
    const persisted =
      '<persisted-output>\nOutput too large (31.2KB). Full output saved to: C:\\Users\\dev\\.claude\\projects\\lane\\s\\tool-results\\bevajw7bp.txt\n\nPreview (first 2KB):\n     1\timport { Loader2 } from "lucide-react";\n</persisted-output>';
    const { sessionId, writer } = newWriter();
    writer.prompt('Show me the composer.');
    const [read] = writer.assistant([
      toolUse('t-big', 'Read', { file_path: join(lane, 'composer.tsx') }),
    ]);
    writer.toolResult(read, 't-big', persisted, {
      toolUseResult: { stdout: 'x'.repeat(31_000), persistedOutputSize: 31920 },
    });
    const [items] = agentItems(await readBack(sessionId, writer));
    expect(tools(items)[0].contentBlocks).toEqual([{ type: 'text', text: persisted }]);
  });

  it('shows a background subagent as its Agent call, carrying the report from its own transcript', async () => {
    const { sessionId, writer } = newWriter();
    writer.prompt('Get a second opinion on the plan.');
    const [agentCall] = writer.assistant([
      toolUse('toolu_agent', 'Agent', {
        description: 'Review the viewing plan',
        subagent_type: 'general-purpose',
        prompt: 'Review docs/plan.md and report risks.',
      }),
    ]);
    writer.toolResult(
      agentCall,
      'toolu_agent',
      [
        {
          type: 'text',
          text: 'Async agent launched successfully. (This tool result is internal metadata.)',
        },
      ],
      {
        toolUseResult: {
          isAsync: true,
          status: 'async_launched',
          agentId: 'af2725f547b0efa1c',
          description: 'Review the viewing plan',
        },
      }
    );
    writer.assistant([text('The reviewer is running.')]);

    const sub = new ClaudeTranscriptWriter({ sessionId, cwd: lane, startAt: T0 + 60_000 });
    sub.prompt('Review docs/plan.md and report risks.');
    const [subRead] = sub.assistant([
      toolUse('t-sub-read', 'Read', { file_path: join(lane, 'docs/plan.md') }),
    ]);
    sub.toolResult(subRead, 't-sub-read', '# Plan');
    sub.assistant([text('Risk: the cache key ignores the branch. '), text('Otherwise sound.')]);
    writeSubagent(
      projectDir,
      sessionId,
      'af2725f547b0efa1c',
      {
        toolUseId: 'toolu_agent',
        description: 'Review the viewing plan',
        agentType: 'general-purpose',
      },
      sub
    );

    const [items] = agentItems(await readBack(sessionId, writer));
    const calls = tools(items);
    expect(calls.map((t) => t.callId)).toEqual(['toolu_agent']);
    expect(calls[0]).toMatchObject({
      name: 'Agent',
      kind: 'agent',
      status: 'completed',
      contentBlocks: [
        { type: 'text', text: 'Risk: the cache key ignores the branch. Otherwise sound.' },
      ],
    });
  });

  it('keeps a foreground subagent result, which already carries its report', async () => {
    const { sessionId, writer } = newWriter();
    writer.prompt('Explore the repo.');
    const [call] = writer.assistant([
      toolUse('toolu_fg', 'Agent', { description: 'Map the repo', prompt: 'Map it.' }),
    ]);
    writer.toolResult(
      call,
      'toolu_fg',
      [{ type: 'text', text: 'Three packages: app, server, protocol.' }],
      {
        toolUseResult: { status: 'completed', agentId: 'a1b2c3', content: [] },
      }
    );
    const [items] = agentItems(await readBack(sessionId, writer));
    expect(tools(items)[0].contentBlocks).toEqual([
      { type: 'text', text: 'Three packages: app, server, protocol.' },
    ]);
  });

  it('writes slash commands and ! commands as what the user typed, and skips what Claude Code wrote itself', async () => {
    const { sessionId, writer } = newWriter();
    writer.userRecord(
      '<local-command-caveat>Caveat: The messages below were generated by the user while running local commands.</local-command-caveat>',
      { isMeta: true }
    );
    writer.userRecord(
      '<command-name>/clear</command-name>\n            <command-message>clear</command-message>\n            <command-args></command-args>'
    );
    writer.system('local_command', { content: '<local-command-stdout></local-command-stdout>' });
    writer.userRecord(
      '<command-message>teach-me</command-message>\n<command-name>/teach-me</command-name>\n<command-args>control graphs</command-args>',
      { origin: { kind: 'human' } }
    );
    writer.userRecord('<local-command-stdout>Set model to `Fable 5.1`</local-command-stdout>');
    writer.userRecord('<bash-input> git status --short</bash-input>');
    writer.userRecord('<bash-stdout> M src/a.ts</bash-stdout><bash-stderr></bash-stderr>');
    writer.userRecord(
      '<task-notification>\n<task-id>bnlzvs3nu</task-id>\n<tool-use-id>toolu_01Mg</tool-use-id>\n<status>completed</status>\n</task-notification>',
      { origin: { kind: 'task-notification' }, promptSource: 'system' }
    );
    writer.prompt('Thanks, continue.');

    const messages = await readBack(sessionId, writer);
    expect(humans(messages)).toEqual([
      '/clear',
      '/teach-me control graphs',
      '! git status --short',
      'Thanks, continue.',
    ]);
  });

  it('refuses a transcript with a line that is not JSON, naming the line', async () => {
    const { sessionId, writer } = newWriter();
    writer.prompt('one');
    writer.assistant([text('two')]);
    const file = writeTranscript(projectDir, sessionId, writer);
    const { appendFileSync } = await import('node:fs');
    appendFileSync(file, '{"type":"user","message":{"role":"user","content":"cut off\n');
    await expect(readClaudeTranscript(file, lane)).rejects.toThrow(/line 3/);
  });

  it('streams a transcript of several megabytes with inline screenshots', async () => {
    const png = 'iVBORw0KGgo' + 'Q'.repeat(20_000);
    const { sessionId, writer } = newWriter();
    for (let i = 0; i < 400; i++) {
      writer.prompt([text(`Screen ${i}: what changed?`), image(png)]);
      writer.assistant([text(`Screen ${i} moved the header.`)]);
    }
    const file = writeTranscript(projectDir, sessionId, writer);
    const { statSync } = await import('node:fs');
    expect(statSync(file).size).toBeGreaterThan(8_000_000);

    const messages = await readClaudeTranscript(file, lane);
    expect(messages).toHaveLength(800);
    expect(humans(messages)[399]).toBe('Screen 399: what changed?\n\n[image]');
    expect(JSON.stringify(messages)).not.toContain('QQQQ');
  });
});
