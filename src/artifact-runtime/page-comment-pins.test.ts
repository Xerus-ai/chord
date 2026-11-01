// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CHORD_ID_ATTRIBUTE, MAX_PAGE_PINS } from '@shared/artifact-frame-constants';
import type { FrameToHostMessage } from '@shared/artifact-frame-messages';
import { createCommentPins, isSetPinsPayload } from './page-comment-pins';
import { createElementPicker } from './page-element-picker';

/**
 * The real pins against a jsdom document. jsdom lays nothing out, so every
 * element reports the same small box, and it has no scrolling: the box and
 * `scrollIntoView` are the only browser APIs filled in here.
 */
const scrolledTo: Element[] = [];
beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }) as DOMRect;
  Element.prototype.scrollIntoView = function scrollIntoView(this: Element) {
    scrolledTo.push(this);
  };
});

afterEach(() => {
  document.body.innerHTML = '';
  document.head.innerHTML = '';
  scrolledTo.length = 0;
});

function page(): { h1: HTMLElement; cta: HTMLElement } {
  document.body.innerHTML = `<h1 ${CHORD_ID_ATTRIBUTE}="h1">Hello</h1><button ${CHORD_ID_ATTRIBUTE}="cta">Start</button>`;
  return {
    h1: document.querySelector('h1') as HTMLElement,
    cta: document.querySelector('button') as HTMLElement,
  };
}

function drawnPins(): { n: string | null; selected: boolean }[] {
  return [...document.querySelectorAll('[data-chord-pin]')].map((pin) => ({
    n: pin.textContent,
    selected: pin.hasAttribute('data-selected'),
  }));
}

function click(target: Element): void {
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
}

describe('createCommentPins', () => {
  it('draws a numbered pin at each stamped element that is in the page', () => {
    page();
    const pins = createCommentPins(() => {});
    pins.setPins(
      [
        { n: 1, chordId: 'h1' },
        { n: 4, chordId: 'cta' },
        { n: 5, chordId: 'gone' },
      ],
      null
    );
    expect(drawnPins()).toEqual([
      { n: '1', selected: false },
      { n: '4', selected: false },
    ]);
  });

  it('clicking a pin tells the host which thread it is', () => {
    page();
    const posted: FrameToHostMessage[] = [];
    const pins = createCommentPins((message) => posted.push(message));
    pins.setPins([{ n: 2, chordId: 'cta' }], null);
    click(document.querySelector('[data-chord-pin]')!);
    expect(posted).toEqual([{ type: 'chord:pin-selected', n: 2 }]);
  });

  it('marks the selected pin and scrolls its element into view', () => {
    const { cta } = page();
    const pins = createCommentPins(() => {});
    pins.setPins(
      [
        { n: 1, chordId: 'h1' },
        { n: 2, chordId: 'cta' },
      ],
      2
    );
    expect(drawnPins()).toEqual([
      { n: '1', selected: false },
      { n: '2', selected: true },
    ]);
    expect(scrolledTo).toEqual([cta]);
  });

  it('does not scroll again when the same selection is re-sent', () => {
    page();
    const pins = createCommentPins(() => {});
    pins.setPins([{ n: 1, chordId: 'h1' }], 1);
    pins.setPins([{ n: 1, chordId: 'h1' }], 1);
    expect(scrolledTo).toHaveLength(1);
  });

  it('an empty list removes every pin', () => {
    page();
    const pins = createCommentPins(() => {});
    pins.setPins([{ n: 1, chordId: 'h1' }], null);
    pins.setPins([], null);
    expect(drawnPins()).toEqual([]);
  });

  it('a pin is runtime chrome: the picker neither picks it nor swallows its click', () => {
    page();
    const posted: FrameToHostMessage[] = [];
    const post = (message: FrameToHostMessage) => posted.push(message);
    const pins = createCommentPins(post);
    const picker = createElementPicker(post);
    pins.setPins([{ n: 3, chordId: 'h1' }], null);
    picker.arm();
    click(document.querySelector('[data-chord-pin]')!);
    picker.disarm();
    expect(posted).toEqual([{ type: 'chord:pin-selected', n: 3 }]);
  });
});

describe('isSetPinsPayload', () => {
  it('accepts numbered pins on stamped ids and a selected number or null', () => {
    expect(isSetPinsPayload([{ n: 1, chordId: 'h1' }], 1)).toBe(true);
    expect(isSetPinsPayload([], null)).toBe(true);
  });

  it('refuses malformed pins, too many pins, and a bad selection', () => {
    const many = Array.from({ length: MAX_PAGE_PINS + 1 }, (_, i) => ({ n: i + 1, chordId: 'h1' }));
    expect(isSetPinsPayload(many, null)).toBe(false);
    expect(isSetPinsPayload([{ n: 0, chordId: 'h1' }], null)).toBe(false);
    expect(isSetPinsPayload([{ n: 1, chordId: 'Bad id' }], null)).toBe(false);
    expect(isSetPinsPayload([{ n: 1 }], null)).toBe(false);
    expect(isSetPinsPayload('pins', null)).toBe(false);
    expect(isSetPinsPayload([], 1.5)).toBe(false);
  });
});
