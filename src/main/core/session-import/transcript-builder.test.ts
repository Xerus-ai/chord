import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import type { StreamItem } from '@shared/stream-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { ImportTranscriptBuilder, type ImportedMessage } from './transcript-builder';

/**
 * The one fold every provider's history goes through on its way into
 * `chat_messages`: a human row per prompt, and an `agent_turn` row per reply
 * whose items have the shapes the live path persists (`persist-agent-turn.ts`,
 * `stream-turn-items.ts`, `track-tool-calls.ts`, `append-turn-text.ts`) — so
 * an imported conversation renders exactly as one Chord ran itself.
 */
const lane = realpathSync(mkdtempSync(join(tmpdir(), 'chord-import-builder-')));
afterAll(() => removeDirSync(lane));

const T0 = Date.parse('2026-10-01T09:00:00.000Z');

function agentTurn(message: ImportedMessage | undefined) {
  if (message?.kind !== 'agent_turn')
    throw new Error(`expected an agent turn, got ${message?.kind}`);
  return message;
}

function kinds(items: StreamItem[]): string[] {
  return items.map((item) => item.kind);
}

describe('ImportTranscriptBuilder', () => {
  it('writes a prompt as a human row and the reply as one agent turn', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('Rename the parser', T0);
    builder.thinking('The parser lives in src/parse.ts.', T0 + 1000);
    builder.openTextBlock();
    builder.appendText('Renamed it.', T0 + 2000);
    const messages = builder.finish();

    expect(messages).toHaveLength(2);
    expect(messages[0]).toEqual({ kind: 'human', content: 'Rename the parser', createdAt: T0 });
    const turn = agentTurn(messages[1]);
    expect(turn.startedAt).toBe(T0 + 1000);
    expect(turn.completedAt).toBe(T0 + 2000);
    expect(turn.items).toEqual([
      {
        kind: 'thinking',
        id: expect.any(String),
        text: 'The parser lives in src/parse.ts.',
        status: 'ready',
        startedAt: T0 + 1000,
      },
      { kind: 'text', id: expect.any(String), text: 'Renamed it.' },
    ]);
  });

  it('opens a paragraph for a new text block and glues deltas within one', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('go', T0);
    builder.openTextBlock();
    builder.appendText('I will read ', T0 + 1);
    builder.appendText('the config.', T0 + 2);
    builder.openTextBlock();
    builder.appendText('It is already set.', T0 + 3);
    const turn = agentTurn(builder.finish()[1]);

    expect(turn.items).toEqual([
      {
        kind: 'text',
        id: expect.any(String),
        text: 'I will read the config.\n\nIt is already set.',
      },
    ]);
  });

  it('groups consecutive tool calls into one card, and text between them splits the card', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('look around', T0);
    builder.toolCall(
      { callId: 'a', name: 'Read', kind: 'read', rawInput: { file_path: 'a.ts' } },
      T0 + 1
    );
    builder.toolCall(
      { callId: 'b', name: 'Grep', kind: 'search', rawInput: { pattern: 'x' } },
      T0 + 2
    );
    builder.openTextBlock();
    builder.appendText('Found it.', T0 + 3);
    builder.toolCall(
      { callId: 'c', name: 'Bash', kind: 'execute', rawInput: { command: 'ls' } },
      T0 + 4
    );
    builder.toolUpdate('a', { status: 'completed' }, T0 + 5);
    builder.toolUpdate('b', { status: 'completed' }, T0 + 5);
    builder.toolUpdate('c', { status: 'completed' }, T0 + 6);
    const turn = agentTurn(builder.finish()[1]);

    expect(kinds(turn.items)).toEqual(['tool_group', 'text', 'tool_group']);
    const [first, , second] = turn.items;
    expect(first.kind === 'tool_group' && first.tools.map((t) => t.callId)).toEqual(['a', 'b']);
    expect(second.kind === 'tool_group' && second.tools.map((t) => t.callId)).toEqual(['c']);
  });

  it('settles a call with its result: status, output, and the input it reported', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('run it', T0);
    builder.toolCall(
      { callId: 'run', name: 'Bash', kind: 'execute', rawInput: { command: 'pnpm test' } },
      T0 + 1
    );
    builder.toolUpdate(
      'run',
      { status: 'failed', contentBlocks: [{ type: 'text', text: 'Exit code 1\n2 failed' }] },
      T0 + 9
    );
    const turn = agentTurn(builder.finish()[1]);

    expect(turn.items[0]).toEqual({
      kind: 'tool_group',
      id: expect.any(String),
      tools: [
        {
          callId: 'run',
          name: 'Bash',
          status: 'failed',
          kind: 'execute',
          rawInput: { command: 'pnpm test' },
          contentBlocks: [{ type: 'text', text: 'Exit code 1\n2 failed' }],
        },
      ],
    });
    expect(turn.completedAt).toBe(T0 + 9);
  });

  it('settles a result that arrives after the next prompt on the call it answers', () => {
    // A prompt queued while a tool ran lands between the call and its result.
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('start the build', T0);
    builder.toolCall({ callId: 'build', name: 'Bash', kind: 'execute' }, T0 + 1);
    builder.prompt('and then lint', T0 + 2);
    builder.toolUpdate('build', { status: 'completed' }, T0 + 3);
    const messages = builder.finish();
    const first = agentTurn(messages[1]);
    const tool = first.items[0].kind === 'tool_group' ? first.items[0].tools[0] : null;
    expect(tool?.status).toBe('completed');
  });

  it('refuses a result for a call it never saw', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('go', T0);
    expect(() => builder.toolUpdate('ghost', { status: 'completed' }, T0 + 1)).toThrow(/ghost/);
  });

  it('marks a call that never got a result as failed, not running forever', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('go', T0);
    builder.toolCall({ callId: 'cut', name: 'Bash', kind: 'execute' }, T0 + 1);
    const turn = agentTurn(builder.finish()[1]);
    const tool = turn.items[0].kind === 'tool_group' ? turn.items[0].tools[0] : null;
    expect(tool?.status).toBe('failed');
  });

  it('skips empty thinking, the redacted form recent transcripts carry', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('go', T0);
    builder.thinking('', T0 + 1);
    builder.thinking('   ', T0 + 2);
    builder.openTextBlock();
    builder.appendText('done', T0 + 3);
    expect(kinds(agentTurn(builder.finish()[1]).items)).toEqual(['text']);
  });

  it('ends each turn with the files its edit tools changed, as a live turn does', () => {
    const file = join(lane, 'src', 'parse.ts');
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('edit it', T0);
    builder.toolCall(
      {
        callId: 'e',
        name: 'Edit',
        kind: 'edit',
        rawInput: { file_path: file },
        contentBlocks: [{ type: 'diff', diff: '-old\n+new\n+more' }],
      },
      T0 + 1
    );
    builder.toolUpdate('e', { status: 'completed' }, T0 + 2);
    const turn = agentTurn(builder.finish()[1]);

    expect(turn.items.at(-1)).toEqual({
      kind: 'file_changes',
      id: expect.any(String),
      files: [{ name: 'parse.ts', filePath: file, added: 2, removed: 1 }],
    });
  });

  it('closes a turn at the time the provider says it ended', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('one', T0);
    builder.openTextBlock();
    builder.appendText('first', T0 + 1000);
    builder.endTurn(T0 + 5000);
    builder.prompt('two', T0 + 6000);
    builder.openTextBlock();
    builder.appendText('second', T0 + 7000);
    const messages = builder.finish();

    expect(messages.map((m) => m.kind)).toEqual(['human', 'agent_turn', 'human', 'agent_turn']);
    expect(agentTurn(messages[1]).completedAt).toBe(T0 + 5000);
    expect(agentTurn(messages[3]).completedAt).toBe(T0 + 7000);
  });

  it('records an error the provider reported as the turn error item', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('go', T0);
    builder.error('Rate limit reached', T0 + 1);
    expect(agentTurn(builder.finish()[1]).items).toEqual([
      { kind: 'error', id: expect.any(String), message: 'Rate limit reached' },
    ]);
  });

  it('keeps two prompts with nothing between them as two human rows', () => {
    const builder = new ImportTranscriptBuilder(lane);
    builder.prompt('one', T0);
    builder.prompt('two', T0 + 1);
    expect(builder.finish()).toEqual([
      { kind: 'human', content: 'one', createdAt: T0 },
      { kind: 'human', content: 'two', createdAt: T0 + 1 },
    ]);
  });
});
