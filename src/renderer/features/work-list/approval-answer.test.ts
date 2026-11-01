import { describe, expect, it } from 'vitest';
import { approvalAnswerOf } from './approval-answer';

/**
 * Whether a viewer can answer the agent's requests now, and if not, which of
 * two reasons: they must not share copy (step 4, S5d).
 */
describe('approvalAnswerOf', () => {
  it('answers when allowed and connected', () => {
    expect(approvalAnswerOf('answer', true)).toBe('answer');
  });

  it('waits for the connection rather than blaming the owner', () => {
    expect(approvalAnswerOf('answer', false)).toBe('reconnecting');
  });

  it('says only the owner answers, connected or not', () => {
    expect(approvalAnswerOf('owner_only', true)).toBe('owner_only');
    expect(approvalAnswerOf('owner_only', false)).toBe('owner_only');
  });

  it('refuses a viewer with no approvals at all', () => {
    expect(() => approvalAnswerOf('none', true)).toThrow();
  });
});
