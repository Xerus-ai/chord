import { describe, expect, it } from 'vitest';
import { USER_INPUT_REQUEST } from './codex-captured-requests';
import { toCodexQuestions, toCodexUserInputResponse } from './codex-questions';

describe('toCodexQuestions', () => {
  it('keeps the question id, its options and whether it takes typed or secret answers', () => {
    expect(toCodexQuestions(USER_INPUT_REQUEST)).toEqual([
      {
        id: 'language',
        header: 'Language',
        question: 'Which programming language should the greeting CLI use?',
        options: [
          {
            label: 'Python (Recommended)',
            description: 'Simple implementation with minimal setup if Python is installed.',
          },
          {
            label: 'Go',
            description: 'Compiles into a standalone executable with straightforward distribution.',
          },
          {
            label: 'Rust',
            description: 'Compiles into a standalone executable with strong compile-time checks.',
          },
        ],
        multiSelect: false,
        allowOther: true,
        secret: false,
      },
    ]);
  });

  it('reads a question without options as typed-only', () => {
    const typed = {
      ...USER_INPUT_REQUEST,
      questions: [{ ...USER_INPUT_REQUEST.questions[0], options: null, isSecret: true }],
    };
    const [question] = toCodexQuestions(typed);
    expect(question.options).toEqual([]);
    expect(question.secret).toBe(true);
  });
});

describe('toCodexUserInputResponse', () => {
  const questions = toCodexQuestions(USER_INPUT_REQUEST);

  // Answering the captured request this way made the live model reply "LANG=Go".
  it('answers each question under its id', () => {
    expect(toCodexUserInputResponse(questions, { language: ['Go'] })).toEqual({
      answers: { language: { answers: ['Go'] } },
    });
  });

  it('answers nothing when the card was dismissed', () => {
    expect(toCodexUserInputResponse(questions, null)).toEqual({ answers: {} });
  });

  it('refuses answers that leave a question out', () => {
    expect(() => toCodexUserInputResponse(questions, {})).toThrow();
  });
});
