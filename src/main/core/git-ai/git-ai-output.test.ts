import { describe, expect, it } from 'vitest';
import { GitAiOutputError, parseCommitMessage, parsePullRequestFields } from './git-ai-output';

/**
 * What the agent answered, read into the field. Anything that is not a usable
 * answer throws — the caller shows the reason and the output, and the field
 * stays exactly as it was. Nothing is invented in its place.
 */
describe('parseCommitMessage', () => {
  it('takes the answer as the message, trimmed', () => {
    expect(parseCommitMessage('\n  Redirect to the dashboard after login\n\n')).toBe(
      'Redirect to the dashboard after login'
    );
  });

  it('keeps a body under the subject', () => {
    expect(
      parseCommitMessage('Redirect after login\n\nThe login page left users on a blank screen.')
    ).toBe('Redirect after login\n\nThe login page left users on a blank screen.');
  });

  it('unwraps an answer the agent fenced', () => {
    expect(parseCommitMessage('```\nRedirect after login\n```')).toBe('Redirect after login');
    expect(parseCommitMessage('```text\nRedirect after login\n```\n')).toBe('Redirect after login');
  });

  it('refuses an empty answer', () => {
    expect(() => parseCommitMessage('   \n')).toThrow(GitAiOutputError);
    expect(() => parseCommitMessage('```\n```')).toThrow(GitAiOutputError);
  });
});

describe('parsePullRequestFields', () => {
  it('reads title and body from the JSON answer', () => {
    expect(
      parsePullRequestFields('{"title":"Redirect after login","body":"## Summary\\nFixes it."}')
    ).toEqual({ title: 'Redirect after login', body: '## Summary\nFixes it.' });
  });

  it('reads JSON the agent fenced or wrapped in a sentence', () => {
    const json = '{"title":"Redirect after login","body":"Fixes it."}';
    expect(parsePullRequestFields('```json\n' + json + '\n```')).toEqual({
      title: 'Redirect after login',
      body: 'Fixes it.',
    });
    expect(parsePullRequestFields(`Here you go:\n${json}`)).toEqual({
      title: 'Redirect after login',
      body: 'Fixes it.',
    });
  });

  it('trims the title and the end of the body', () => {
    expect(parsePullRequestFields('{"title":"  Redirect  ","body":"Fixes it.\\n\\n"}')).toEqual({
      title: 'Redirect',
      body: 'Fixes it.',
    });
  });

  it('refuses an answer that is not JSON', () => {
    expect(() => parsePullRequestFields('Redirect after login')).toThrow(GitAiOutputError);
  });

  it('refuses JSON without a title, or whose body is not text', () => {
    expect(() => parsePullRequestFields('{"body":"Fixes it."}')).toThrow(GitAiOutputError);
    expect(() => parsePullRequestFields('{"title":"  ","body":"Fixes it."}')).toThrow(
      GitAiOutputError
    );
    expect(() => parsePullRequestFields('{"title":"Redirect","body":42}')).toThrow(
      GitAiOutputError
    );
  });
});
