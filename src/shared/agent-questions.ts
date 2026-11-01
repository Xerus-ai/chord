/**
 * Questions an agent asks the user mid-turn and waits on — Claude's
 * AskUserQuestion tool, Codex's request_user_input — in one shape, so one
 * card answers them all.
 */

export interface AgentQuestionOption {
  label: string;
  description?: string;
}

export interface AgentQuestion {
  /** The agent's own key for the question; answers are returned under it. */
  id: string;
  /** A short tag for the question ("Language"). */
  header: string;
  question: string;
  /** May be empty: the question then takes a typed answer only. */
  options: AgentQuestionOption[];
  multiSelect: boolean;
  /** Whether a typed answer may stand in for (or join) the options. */
  allowOther: boolean;
  /** A secret answer (a token, a password) is masked and never kept in the transcript. */
  secret: boolean;
}

/** Per question id: the options picked and/or the text typed, in that order. */
export type AgentQuestionAnswers = Record<string, string[]>;

/** How a secret answer is kept in the transcript. */
export const SECRET_ANSWER_MASK = '••••••';

/**
 * The answer to one question from the options picked and the text typed,
 * or null while it has none. A single-select question takes one value: the
 * typed text when there is any, else the picked option.
 */
export function composeQuestionAnswer(
  question: AgentQuestion,
  picked: readonly string[],
  typed: string
): string[] | null {
  const text = question.allowOther || question.options.length === 0 ? typed.trim() : '';
  const values = question.multiSelect
    ? [...picked, ...(text ? [text] : [])]
    : [text || picked[0]].filter((value): value is string => Boolean(value));
  return values.length > 0 ? values : null;
}

/** The answers as the transcript keeps them: secret ones masked. */
export function maskSecretAnswers(
  questions: readonly AgentQuestion[],
  answers: AgentQuestionAnswers
): AgentQuestionAnswers {
  const masked: AgentQuestionAnswers = {};
  for (const question of questions) {
    const answer = answers[question.id];
    if (answer === undefined) continue;
    masked[question.id] = question.secret ? [SECRET_ANSWER_MASK] : answer;
  }
  return masked;
}
