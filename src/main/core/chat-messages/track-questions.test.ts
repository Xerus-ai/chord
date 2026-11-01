import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SECRET_ANSWER_MASK, type AgentQuestion } from '@shared/agent-questions';
import type { StreamItem, TurnStreamEvent } from '@shared/stream-items';

// The IPC boundary, replaced as in stream-turn-items.test.ts.
const emitted: TurnStreamEvent[] = [];
vi.mock('@main/lib/events', () => ({
  events: { emit: (_channel: unknown, data: TurnStreamEvent) => emitted.push(data) },
}));

const { TurnItemStream } = await import('./stream-turn-items');
const { QuestionTracker } = await import('./track-questions');

const language: AgentQuestion = {
  id: 'language',
  header: 'Language',
  question: 'Which language?',
  options: [{ label: 'Go' }, { label: 'Rust' }],
  multiSelect: false,
  allowOther: true,
  secret: false,
};
const token: AgentQuestion = { ...language, id: 'token', options: [], secret: true };

function questionItem(stream: InstanceType<typeof TurnItemStream>): StreamItem | undefined {
  return stream.listItems().find((item) => item.kind === 'question');
}

describe('QuestionTracker', () => {
  let stream: InstanceType<typeof TurnItemStream>;
  let tracker: InstanceType<typeof QuestionTracker>;

  beforeEach(() => {
    emitted.length = 0;
    stream = new TurnItemStream();
    tracker = new QuestionTracker(stream);
  });

  it('shows the question at once, not with the next batch', () => {
    tracker.request('wi-1', 'req-1', [language]);
    expect(emitted.map((e) => e.action.type)).toEqual(['item_added']);
    expect(questionItem(stream)).toMatchObject({
      kind: 'question',
      requestId: 'req-1',
      questions: [language],
      status: 'pending',
    });
  });

  it('keeps the answers, masking secret ones', () => {
    tracker.request('wi-1', 'req-1', [language, token]);
    tracker.resolve('wi-1', 'req-1', { language: ['Go'], token: ['sk-123'] });
    expect(questionItem(stream)).toMatchObject({
      status: 'answered',
      answers: { language: ['Go'], token: [SECRET_ANSWER_MASK] },
    });
  });

  it('marks a dismissed question, and settles a question only once', () => {
    tracker.request('wi-1', 'req-1', [language]);
    tracker.resolve('wi-1', 'req-1', null);
    tracker.resolve('wi-1', 'req-1', { language: ['Go'] });
    expect(questionItem(stream)).toMatchObject({ status: 'dismissed' });
    expect(questionItem(stream)).not.toHaveProperty('answers');
  });
});
