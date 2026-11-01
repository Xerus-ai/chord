import { MessageCircleQuestionMark } from 'lucide-react';
import { useState } from 'react';
import { type AgentProviderId } from '@shared/agent-provider-registry';
import { getProvider } from '@shared/agent-providers';
import {
  composeQuestionAnswer,
  type AgentQuestion,
  type AgentQuestionAnswers,
} from '@shared/agent-questions';
import {
  AgentCard,
  AgentCardActions,
  AgentCardGhostButton,
  AgentCardHeader,
  AgentCardPrimaryButton,
} from '@renderer/lib/components/chrome/agent-card';
import { rpc } from '@renderer/lib/ipc';

interface QuestionCardProps {
  workItemId: string;
  requestId: string;
  agentProvider: AgentProviderId;
  questions: AgentQuestion[];
}

/**
 * The agent's questions, pinned above the composer while the agent waits:
 * pick an option (or several, for a multi-select), or type an answer where
 * the question takes one. Skip dismisses them all; the agent carries on
 * without the answers.
 */
export function QuestionCard({
  workItemId,
  requestId,
  agentProvider,
  questions,
}: QuestionCardProps) {
  const [picked, setPicked] = useState<Record<string, string[]>>({});
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const answers: AgentQuestionAnswers = {};
  for (const question of questions) {
    const answer = composeQuestionAnswer(
      question,
      picked[question.id] ?? [],
      typed[question.id] ?? ''
    );
    if (answer) answers[question.id] = answer;
  }
  const complete = questions.every((question) => answers[question.id] !== undefined);

  const togglePick = (question: AgentQuestion, label: string) => {
    setPicked((current) => {
      const selected = current[question.id] ?? [];
      if (!question.multiSelect) return { ...current, [question.id]: [label] };
      return {
        ...current,
        [question.id]: selected.includes(label)
          ? selected.filter((value) => value !== label)
          : [...selected, label],
      };
    });
    // A pick replaces a typed answer on a single-select question.
    if (!question.multiSelect) setTyped((current) => ({ ...current, [question.id]: '' }));
  };

  const respond = (reply: AgentQuestionAnswers | null) => {
    if (responding) return;
    setResponding(true);
    setError(null);
    rpc.acp
      .respondToQuestion({ workItemId, requestId, answers: reply })
      .then((result) => {
        // On success the card unmounts once the item settles; on failure the
        // agent is still waiting, so the card stays answerable.
        if (result.success) return;
        setResponding(false);
        setError('The agent session is no longer running, so this question cannot be answered.');
      })
      .catch((e: unknown) => {
        setResponding(false);
        setError(e instanceof Error ? e.message : String(e));
      });
  };

  const agentName = getProvider(agentProvider)?.name ?? agentProvider;

  return (
    <AgentCard>
      <AgentCardHeader
        icon={MessageCircleQuestionMark}
        title={`${agentName} ${questions.length === 1 ? 'has a question' : `has ${questions.length} questions`}`}
      />
      {/* Several questions with described options outgrow the window; they
          scroll here so the actions and the composer stay in view. */}
      <div className="max-h-[45vh] overflow-y-auto">
        {questions.map((question) => (
          <QuestionField
            key={question.id}
            question={question}
            picked={picked[question.id] ?? []}
            typed={typed[question.id] ?? ''}
            disabled={responding}
            onPick={(label) => togglePick(question, label)}
            onType={(text) => setTyped((current) => ({ ...current, [question.id]: text }))}
          />
        ))}
      </div>
      {error && (
        <p className="mx-[14px] mb-3 rounded-[var(--radius-sm)] border border-border px-3 py-2 text-tiny tracking-tiny text-status-err">
          {error}
        </p>
      )}
      <AgentCardActions>
        <AgentCardGhostButton onClick={() => respond(null)} disabled={responding}>
          Skip
        </AgentCardGhostButton>
        <AgentCardPrimaryButton onClick={() => respond(answers)} disabled={!complete || responding}>
          Answer
        </AgentCardPrimaryButton>
      </AgentCardActions>
    </AgentCard>
  );
}

function QuestionField({
  question,
  picked,
  typed,
  disabled,
  onPick,
  onType,
}: {
  question: AgentQuestion;
  picked: string[];
  typed: string;
  disabled: boolean;
  onPick: (label: string) => void;
  onType: (text: string) => void;
}) {
  const takesTyped = question.allowOther || question.options.length === 0;
  return (
    <div className="flex flex-col gap-2 border-t border-border px-[14px] py-2.5">
      <div className="flex flex-col gap-0.5">
        {question.header && (
          <span className="text-tiny tracking-tiny text-text-passive">{question.header}</span>
        )}
        <span className="text-body tracking-body text-text">{question.question}</span>
      </div>
      {question.options.length > 0 && (
        <div
          role={question.multiSelect ? 'group' : 'radiogroup'}
          aria-label={question.question}
          className="flex flex-col gap-1"
        >
          {question.options.map((option) => {
            const selected = picked.includes(option.label);
            return (
              <button
                key={option.label}
                type="button"
                role={question.multiSelect ? 'checkbox' : 'radio'}
                aria-checked={selected}
                disabled={disabled}
                onClick={() => onPick(option.label)}
                className={`flex cursor-pointer flex-col items-start rounded-[var(--radius-sm)] border px-2.5 py-1.5 text-left transition-[background,border-color] duration-100 disabled:cursor-default ${
                  selected
                    ? 'border-border-strong bg-surface-hover-solid'
                    : 'border-border bg-surface hover:bg-surface-inset'
                }`}
              >
                <span className="text-body tracking-body text-text">{option.label}</span>
                {option.description && (
                  <span className="text-tiny tracking-tiny text-text-muted">
                    {option.description}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
      {takesTyped && (
        <input
          type={question.secret ? 'password' : 'text'}
          value={typed}
          disabled={disabled}
          onChange={(e) => onType(e.target.value)}
          placeholder={question.options.length > 0 ? 'Something else…' : 'Your answer'}
          aria-label={`${question.question} — typed answer`}
          className="rounded-[var(--radius-sm)] border border-border bg-surface-inset px-2.5 py-1.5 text-body tracking-body text-text outline-none placeholder:text-text-passive focus:border-border-strong"
        />
      )}
    </div>
  );
}
