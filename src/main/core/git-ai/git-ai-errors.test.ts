import { describe, expect, it } from 'vitest';
import { boundAgentOutput, GIT_AI_OUTPUT_LIMIT } from './git-ai-errors';

/**
 * A failure shows the agent's output, bounded: a runaway answer or a long
 * stack trace must not flood the dialog or the IPC channel, but where CLIs
 * put the reason — first lines or last — survives.
 */
describe('boundAgentOutput', () => {
  it('keeps short output whole', () => {
    expect(boundAgentOutput('Invalid API key · Please run /login')).toEqual({
      text: 'Invalid API key · Please run /login',
      omittedChars: 0,
    });
  });

  it('keeps the start and the end of long output, and counts what it dropped', () => {
    const head = 'HEAD-REASON ';
    const tail = ' TAIL-REASON';
    const long = head + 'x'.repeat(GIT_AI_OUTPUT_LIMIT * 3) + tail;
    const bounded = boundAgentOutput(long);

    expect(bounded.text.startsWith(head)).toBe(true);
    expect(bounded.text.endsWith(tail)).toBe(true);
    expect(bounded.omittedChars).toBeGreaterThan(0);
    expect(bounded.text.length).toBeLessThanOrEqual(GIT_AI_OUTPUT_LIMIT + 100);
    expect(bounded.text).toContain(`${bounded.omittedChars} characters omitted`);
  });

  it('drops terminal colour codes and other control characters, keeping lines', () => {
    expect(boundAgentOutput('\u001b[31merror\u001b[0m: no model\r\nsecond line\u0007').text).toBe(
      'error: no model\nsecond line'
    );
  });
});
