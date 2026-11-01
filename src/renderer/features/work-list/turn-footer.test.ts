import { describe, expect, it } from 'vitest';
import type { AgentTurn } from '@shared/stream-items';
import { formatTurnDuration, turnTextAsMarkdown } from './turn-footer';

describe('formatTurnDuration', () => {
  it('clamps sub-second durations to 1s', () => {
    expect(formatTurnDuration(0)).toBe('1s');
    expect(formatTurnDuration(499)).toBe('1s');
  });

  it('formats seconds under a minute', () => {
    expect(formatTurnDuration(12_000)).toBe('12s');
    expect(formatTurnDuration(59_400)).toBe('59s');
  });

  it('formats minutes and seconds', () => {
    expect(formatTurnDuration(65_000)).toBe('1m 5s');
    expect(formatTurnDuration(600_000)).toBe('10m 0s');
  });

  it('rounds to the nearest second', () => {
    expect(formatTurnDuration(11_600)).toBe('12s');
  });
});

describe('turnTextAsMarkdown', () => {
  function makeTurn(items: AgentTurn['items']): AgentTurn {
    return {
      id: 't1',
      workItemId: 'wi-1',
      agentName: 'Claude',
      items,
      status: 'complete',
      timestamp: 1700000000,
    };
  }

  it('joins text items with blank lines', () => {
    const turn = makeTurn([
      { kind: 'text', id: 'i1', text: 'First paragraph.' },
      { kind: 'text', id: 'i2', text: 'Second paragraph.' },
    ]);
    expect(turnTextAsMarkdown(turn)).toBe('First paragraph.\n\nSecond paragraph.');
  });

  it('skips thinking, tool, and file_changes items', () => {
    const turn = makeTurn([
      { kind: 'thinking', id: 'i1', text: 'pondering', status: 'ready', startedAt: 0 },
      { kind: 'text', id: 'i2', text: 'The answer.' },
      { kind: 'tool_group', id: 'i3', tools: [] },
      { kind: 'file_changes', id: 'i4', files: [] },
    ]);
    expect(turnTextAsMarkdown(turn)).toBe('The answer.');
  });

  it('returns empty string for a turn with no text items', () => {
    const turn = makeTurn([
      { kind: 'thinking', id: 'i1', text: 'pondering', status: 'ready', startedAt: 0 },
    ]);
    expect(turnTextAsMarkdown(turn)).toBe('');
  });
});
