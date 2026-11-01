import { beforeEach, describe, expect, it } from 'vitest';
import {
  requestMessageReveal,
  takeMessageReveal,
  useMessageRevealRequests,
  type MessageRevealRequest,
} from './message-reveal-request';

const REQUEST: MessageRevealRequest = {
  messageId: 'm1',
  createdAt: '2026-10-01T10:00:00.000Z',
  row: null,
  notFound: false,
};

/**
 * "Reveal this message in this tab" (step 5): the notification click asks,
 * the chat tab takes the request once, whether it was just opened or was
 * already open. Client-only; a request outlives nothing.
 */
describe('message reveal requests', () => {
  beforeEach(() => useMessageRevealRequests.setState({ requests: {} }));

  it('is taken once by the tab it names', () => {
    requestMessageReveal('w1', { kind: 'session', sessionId: 's1' }, REQUEST);
    expect(takeMessageReveal('w1', { kind: 'session', sessionId: 's2' })).toBeNull();
    expect(takeMessageReveal('participant:w1', { kind: 'session', sessionId: 's1' })).toBeNull();
    expect(takeMessageReveal('w1', { kind: 'session', sessionId: 's1' })).toEqual(REQUEST);
    expect(takeMessageReveal('w1', { kind: 'session', sessionId: 's1' })).toBeNull();
  });

  it('a newer request for the same tab replaces the older', () => {
    requestMessageReveal('w1', { kind: 'item-chat' }, REQUEST);
    requestMessageReveal('w1', { kind: 'item-chat' }, { ...REQUEST, messageId: 'm2' });
    expect(takeMessageReveal('w1', { kind: 'item-chat' })?.messageId).toBe('m2');
  });
});
