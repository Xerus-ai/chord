import { describe, expect, it } from 'vitest';
import { MAX_EDITABLE_IDS, MAX_PAGE_PINS } from './artifact-frame-constants';
import { frameToHostMessageSchema, hostToFrameMessageSchema } from './artifact-frame-messages';

/** Comment pins on a page (shared-items step 1, S6): host -> frame and frame -> host. */
describe('chord:set-pins', () => {
  const pins = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ n: i + 1, chordId: `c${i}` }));

  it('accepts numbered pins on stamped ids, with or without a selected pin', () => {
    expect(
      hostToFrameMessageSchema.safeParse({ type: 'chord:set-pins', pins: pins(2), selected: 2 })
        .success
    ).toBe(true);
    expect(
      hostToFrameMessageSchema.safeParse({ type: 'chord:set-pins', pins: [], selected: null })
        .success
    ).toBe(true);
  });

  it(`refuses more than ${MAX_PAGE_PINS} pins`, () => {
    const message = { type: 'chord:set-pins', pins: pins(MAX_PAGE_PINS + 1), selected: null };
    expect(hostToFrameMessageSchema.safeParse(message).success).toBe(false);
  });

  it('refuses a pin whose id is not a stamped id, or whose number is not a positive integer', () => {
    for (const pin of [
      { n: 1, chordId: 'NOT an id' },
      { n: 1, chordId: '' },
      { n: 0, chordId: 'c1' },
      { n: 1.5, chordId: 'c1' },
      { n: 1 },
    ]) {
      const message = { type: 'chord:set-pins', pins: [pin], selected: null };
      expect(hostToFrameMessageSchema.safeParse(message).success).toBe(false);
    }
  });

  it('refuses a selected number that is not a positive integer', () => {
    const message = { type: 'chord:set-pins', pins: pins(1), selected: -1 };
    expect(hostToFrameMessageSchema.safeParse(message).success).toBe(false);
  });
});

describe('chord:pin-selected', () => {
  it('accepts a positive integer pin number', () => {
    expect(frameToHostMessageSchema.safeParse({ type: 'chord:pin-selected', n: 3 }).success).toBe(
      true
    );
  });

  it('refuses anything else', () => {
    for (const n of [0, -2, 1.5, '3', null]) {
      expect(frameToHostMessageSchema.safeParse({ type: 'chord:pin-selected', n }).success).toBe(
        false
      );
    }
  });
});

/** Edit text lists the elements that are text in the source (S6, editable-text-ids.ts). */
describe('chord:set-mode', () => {
  it('carries the editable ids', () => {
    const message = { type: 'chord:set-mode', mode: 'edit-text', editableIds: ['h1', 'cta'] };
    expect(hostToFrameMessageSchema.safeParse(message).success).toBe(true);
  });

  it('refuses a mode message without the list, with a bad id, or with too many ids', () => {
    const many = Array.from({ length: MAX_EDITABLE_IDS + 1 }, (_, i) => `c${i}`);
    for (const editableIds of [undefined, ['NOT VALID'], many]) {
      const message = { type: 'chord:set-mode', mode: 'edit-text', editableIds };
      expect(hostToFrameMessageSchema.safeParse(message).success).toBe(false);
    }
  });
});
