import { randomUUID } from 'node:crypto';
import {
  maskSecretAnswers,
  type AgentQuestion,
  type AgentQuestionAnswers,
} from '@shared/agent-questions';
import type { StreamItem } from '@shared/stream-items';
import type { TurnItemStream } from './stream-turn-items';

type QuestionItem = Extract<StreamItem, { kind: 'question' }>;

/**
 * The question card's lifecycle in the live turn: shown when the agent asks,
 * settled when the user answers or dismisses it. The item keeps the answers
 * for the transcript with secret ones masked; the agent gets the real ones.
 */
export class QuestionTracker {
  constructor(private readonly stream: TurnItemStream) {}

  request(workItemId: string, requestId: string, questions: AgentQuestion[]): void {
    this.stream.add(workItemId, {
      kind: 'question',
      id: randomUUID(),
      requestId,
      questions,
      status: 'pending',
    });
  }

  /** `answers` null = dismissed. */
  resolve(workItemId: string, requestId: string, answers: AgentQuestionAnswers | null): void {
    const item = this.stream.findLastItem(
      (candidate): candidate is QuestionItem =>
        candidate.kind === 'question' && candidate.requestId === requestId
    );
    if (!item || item.status !== 'pending') return;
    if (answers === null) {
      item.status = 'dismissed';
    } else {
      item.status = 'answered';
      item.answers = maskSecretAnswers(item.questions, answers);
    }
    this.stream.update(workItemId, item);
  }
}
