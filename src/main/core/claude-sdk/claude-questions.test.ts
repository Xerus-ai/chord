import { describe, expect, it } from 'vitest';
import { toClaudeAnsweredInput, toClaudeQuestions } from './claude-questions';

// Captured from a live Claude Agent SDK 0.3.265 canUseTool call (haiku) on
// 2026-09-24. Allowing it with these answers made the model reply
// "LANG=Go FEATURES=Colors, Timestamps".
const ASK_USER_QUESTION_INPUT = {
  questions: [
    {
      question: 'Which language would you like to use for the greeting CLI?',
      header: 'Language',
      options: [
        { label: 'Python', description: 'Simple, readable, great for quick scripts' },
        { label: 'Go', description: 'Fast compilation, easy deployment, built-in concurrency' },
        { label: 'Rust', description: 'High performance, memory-safe, excellent error handling' },
      ],
      multiSelect: false,
    },
    {
      question: 'Which features would you like to include?',
      header: 'Features',
      options: [
        { label: 'Colors', description: 'Colorized terminal output' },
        { label: 'Emoji', description: 'Emoji support in greetings' },
        { label: 'Timestamps', description: 'Display timestamps with greetings' },
      ],
      multiSelect: true,
    },
  ],
};
const LANGUAGE = 'Which language would you like to use for the greeting CLI?';
const FEATURES = 'Which features would you like to include?';

describe('toClaudeQuestions', () => {
  it('keys each question by its text and keeps its options and select mode', () => {
    const [language, features] = toClaudeQuestions(ASK_USER_QUESTION_INPUT);
    expect(language).toEqual({
      id: LANGUAGE,
      header: 'Language',
      question: LANGUAGE,
      options: ASK_USER_QUESTION_INPUT.questions[0].options,
      multiSelect: false,
      allowOther: true,
      secret: false,
    });
    expect(features.id).toBe(FEATURES);
    expect(features.multiSelect).toBe(true);
  });

  it('refuses a call without questions', () => {
    expect(() => toClaudeQuestions({ questions: [] })).toThrow();
  });
});

describe('toClaudeAnsweredInput', () => {
  it('adds one string per question, joining a multi-select', () => {
    expect(
      toClaudeAnsweredInput(ASK_USER_QUESTION_INPUT, {
        [LANGUAGE]: ['Go'],
        [FEATURES]: ['Colors', 'Timestamps'],
      })
    ).toEqual({
      ...ASK_USER_QUESTION_INPUT,
      answers: { [LANGUAGE]: 'Go', [FEATURES]: 'Colors, Timestamps' },
    });
  });

  it('refuses answers that leave a question out', () => {
    expect(() => toClaudeAnsweredInput(ASK_USER_QUESTION_INPUT, { [LANGUAGE]: ['Go'] })).toThrow();
  });
});
