import { MessageCircleQuestionMark } from 'lucide-react';
import type { StreamItem } from '@shared/stream-items';
import { AgentCard, AgentCardHeader } from '@renderer/lib/components/chrome/agent-card';

type QuestionItem = Extract<StreamItem, { kind: 'question' }>;

/**
 * A settled question card in the transcript: each question with the answer
 * the agent got (secret ones arrive masked), or that it was skipped. A
 * pending one is pinned above the composer instead (`QuestionCard`).
 */
export function QuestionSummary({ item }: { item: QuestionItem }) {
  const count = item.questions.length;
  const noun = count === 1 ? 'question' : `${count} questions`;
  return (
    <div className="mt-1">
      <AgentCard>
        <AgentCardHeader
          icon={MessageCircleQuestionMark}
          tone="done"
          title={item.status === 'answered' ? `Answered ${noun}` : `Skipped ${noun}`}
        />
        {item.questions.map((question) => (
          <div
            key={question.id}
            className="flex flex-col gap-0.5 border-t border-border px-[14px] py-2 text-body tracking-body"
          >
            <span className="text-text-muted">{question.question}</span>
            {item.answers?.[question.id] && (
              <span className="text-text">{item.answers[question.id].join(', ')}</span>
            )}
          </div>
        ))}
      </AgentCard>
    </div>
  );
}
