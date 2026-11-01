import type { AgentQuestion, AgentQuestionAnswers } from '@shared/agent-questions';

/**
 * Claude's AskUserQuestion tool. The call parks in `canUseTool` like any gated
 * tool; allowing it with `answers` in the updated input is how the CLI hands
 * the user's choices to the model — keyed by the question text, one string per
 * question (a multi-select joins its picks), as the SDK's AskUserQuestionInput
 * declares.
 */

export const ASK_USER_QUESTION_TOOL = 'AskUserQuestion';

function readQuestions(input: Record<string, unknown>): Record<string, unknown>[] {
  if (!Array.isArray(input.questions) || input.questions.length === 0) {
    throw new Error('AskUserQuestion was called without questions');
  }
  return input.questions.map((question) => {
    if (typeof question !== 'object' || question === null) {
      throw new Error('AskUserQuestion sent a question that is not an object');
    }
    return question as Record<string, unknown>;
  });
}

/** The tool input's questions; each is keyed by its own text, as the answers must be. */
export function toClaudeQuestions(input: Record<string, unknown>): AgentQuestion[] {
  return readQuestions(input).map((question) => {
    if (typeof question.question !== 'string') {
      throw new Error('AskUserQuestion sent a question without text');
    }
    const options = Array.isArray(question.options) ? question.options : [];
    return {
      id: question.question,
      header: typeof question.header === 'string' ? question.header : '',
      question: question.question,
      options: options.map((option: { label: string; description?: string }) => ({
        label: option.label,
        description: option.description,
      })),
      multiSelect: question.multiSelect === true,
      // The CLI's own picker always offers "Other"; the tool asks models not to list one.
      allowOther: true,
      secret: false,
    };
  });
}

/** The tool input to allow the call with: the original input plus the user's answers. */
export function toClaudeAnsweredInput(
  input: Record<string, unknown>,
  answers: AgentQuestionAnswers
): Record<string, unknown> {
  const joined: Record<string, string> = {};
  for (const question of toClaudeQuestions(input)) {
    const answer = answers[question.id];
    if (!answer || answer.length === 0) {
      throw new Error(`No answer for the question "${question.question}"`);
    }
    joined[question.id] = answer.join(', ');
  }
  return { ...input, answers: joined };
}
