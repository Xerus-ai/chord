import type { AgentQuestion, AgentQuestionAnswers } from '@shared/agent-questions';
import type { McpServerElicitationRequestResponse } from './protocol/v2/McpServerElicitationRequestResponse';
import type { ToolRequestUserInputParams } from './protocol/v2/ToolRequestUserInputParams';
import type { ToolRequestUserInputResponse } from './protocol/v2/ToolRequestUserInputResponse';

/** A question Codex asks mid-turn (its request_user_input tool, plan mode by default). */
export const USER_INPUT_METHOD = 'item/tool/requestUserInput';

export function toCodexQuestions(params: ToolRequestUserInputParams): AgentQuestion[] {
  if (params.questions.length === 0) throw new Error('Codex asked for input without questions');
  return params.questions.map((question) => ({
    id: question.id,
    header: question.header,
    question: question.question,
    options: (question.options ?? []).map((option) => ({
      label: option.label,
      description: option.description,
    })),
    multiSelect: false,
    allowOther: question.isOther,
    secret: question.isSecret,
  }));
}

/**
 * The reply: each question's answers under its id. A dismissed card answers
 * nothing (`answers: {}`), as the Codex TUI does; the model then
 * carries on without it.
 */
export function toCodexUserInputResponse(
  questions: readonly AgentQuestion[],
  answers: AgentQuestionAnswers | null
): ToolRequestUserInputResponse {
  if (answers === null) return { answers: {} };
  const reply: ToolRequestUserInputResponse = { answers: {} };
  for (const question of questions) {
    const answer = answers[question.id];
    if (!answer || answer.length === 0) {
      throw new Error(`No answer for the question "${question.question}"`);
    }
    reply.answers[question.id] = { answers: answer };
  }
  return reply;
}

/**
 * An MCP server's own data form or URL flow, which no Chord card shows:
 * declined through the protocol, so the server learns the user said no rather
 * than seeing an RPC error.
 */
export const DECLINED_ELICITATION: McpServerElicitationRequestResponse = {
  action: 'decline',
  content: null,
  _meta: null,
};
