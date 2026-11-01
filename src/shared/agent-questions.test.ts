import { describe, expect, it } from 'vitest';
import {
  composeQuestionAnswer,
  maskSecretAnswers,
  SECRET_ANSWER_MASK,
  type AgentQuestion,
} from './agent-questions';

const single: AgentQuestion = {
  id: 'language',
  header: 'Language',
  question: 'Which language?',
  options: [{ label: 'Go' }, { label: 'Rust' }],
  multiSelect: false,
  allowOther: true,
  secret: false,
};
const multi: AgentQuestion = { ...single, id: 'features', multiSelect: true };
const typedOnly: AgentQuestion = { ...single, id: 'token', options: [], allowOther: false };

describe('composeQuestionAnswer', () => {
  it('has no answer until something is picked or typed', () => {
    expect(composeQuestionAnswer(single, [], '  ')).toBeNull();
  });

  it('takes the picked option of a single-select question', () => {
    expect(composeQuestionAnswer(single, ['Go'], '')).toEqual(['Go']);
  });

  it('lets typed text stand in for the options', () => {
    expect(composeQuestionAnswer(single, ['Go'], ' Zig ')).toEqual(['Zig']);
  });

  it('ignores typed text when the question takes no other answer', () => {
    expect(composeQuestionAnswer({ ...single, allowOther: false }, ['Go'], 'Zig')).toEqual(['Go']);
  });

  it('keeps every pick of a multi-select question, then the typed text', () => {
    expect(composeQuestionAnswer(multi, ['Go', 'Rust'], 'Zig')).toEqual(['Go', 'Rust', 'Zig']);
  });

  it('takes typed text for a question without options', () => {
    expect(composeQuestionAnswer(typedOnly, [], 'sk-123')).toEqual(['sk-123']);
  });
});

describe('maskSecretAnswers', () => {
  it('masks secret answers and keeps the rest', () => {
    const secret = { ...typedOnly, secret: true };
    expect(maskSecretAnswers([single, secret], { language: ['Go'], token: ['sk-123'] })).toEqual({
      language: ['Go'],
      token: [SECRET_ANSWER_MASK],
    });
  });
});
