import { describe, expect, it } from 'vitest';
import {
  buildNeedsYouReasons,
  countUnseenMentions,
  mentionsUser,
  type NeedsYouInput,
} from './needs-you';

function input(overrides: Partial<NeedsYouInput>): NeedsYouInput {
  return {
    pendingPermissionCount: 0,
    pendingPlanCount: 0,
    mentionCount: 0,
    ...overrides,
  };
}

describe('buildNeedsYouReasons', () => {
  it('is empty with nothing pending', () => {
    expect(buildNeedsYouReasons(input({}))).toEqual([]);
  });

  it('includes each pending request with its count', () => {
    expect(buildNeedsYouReasons(input({ pendingPermissionCount: 2, pendingPlanCount: 1 }))).toEqual(
      [
        { kind: 'pending_permission', count: 2 },
        { kind: 'pending_plan', count: 1 },
      ]
    );
  });

  it('adds unseen mentions with their count', () => {
    expect(buildNeedsYouReasons(input({ mentionCount: 3 }))).toEqual([
      { kind: 'mentioned', count: 3 },
    ]);
  });
});

const ME = { userId: 'u-me', username: 'Ana Lee', email: 'ana@example.com' };

describe('mentionsUser', () => {
  it('matches display name, email, and @everyone', () => {
    expect(mentionsUser('@Ana Lee can you look?', ME)).toBe(true);
    expect(mentionsUser('ping @ana@example.com', ME)).toBe(true);
    expect(mentionsUser('@everyone standup', ME)).toBe(true);
  });

  it('respects token boundaries', () => {
    expect(mentionsUser('@Ana Lee-Smith is here', ME)).toBe(false);
    expect(mentionsUser('mail@Ana Lee', ME)).toBe(false);
    expect(mentionsUser('@ana@example.community', ME)).toBe(false);
    expect(mentionsUser('thanks @Ana Lee.', ME)).toBe(true);
  });
});

describe('countUnseenMentions', () => {
  const teammate = (content: string, createdAt: number) => ({
    senderId: 'u-teammate',
    content,
    createdAt,
  });

  it('counts only mentions newer than the last view', () => {
    const messages = [teammate('@Ana Lee old', 100), teammate('@Ana Lee new', 200)];
    expect(countUnseenMentions(messages, ME, 150)).toBe(1);
  });

  it('counts every mention when the item was never opened', () => {
    const messages = [teammate('@Ana Lee one', 100), teammate('@everyone two', 200)];
    expect(countUnseenMentions(messages, ME, undefined)).toBe(2);
  });

  it('ignores own and identity-less messages and non-mentions', () => {
    const messages = [
      { senderId: 'u-me', content: '@everyone from me', createdAt: 300 },
      { senderId: null, content: '@Ana Lee signed out', createdAt: 300 },
      teammate('no mention here', 300),
    ];
    expect(countUnseenMentions(messages, ME, 0)).toBe(0);
  });
});
