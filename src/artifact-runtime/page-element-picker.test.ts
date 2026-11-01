// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { MAX_PICKED_SELECTOR_LENGTH } from '@shared/artifact-frame-constants';
import type { FrameToHostMessage, PickedElement } from '@shared/artifact-frame-messages';
import { createElementPicker } from './page-element-picker';

/**
 * The real picker against a jsdom document. jsdom lays nothing out, so every
 * element reports the same small box — enough for `isPickable`, which only
 * refuses elements under 4px.
 */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }) as DOMRect;
});

afterEach(() => {
  document.body.innerHTML = '';
});

function pick(element: Element): PickedElement {
  let picked: PickedElement | null = null;
  const picker = createElementPicker((message: FrameToHostMessage) => {
    if (message.type === 'chord:element-picked') picked = message.element;
  });
  picker.arm();
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  picker.disarm();
  if (!picked) throw new Error('Nothing was picked');
  return picked;
}

describe('createElementPicker — fallback CSS path', () => {
  it('anchors a path that reaches the body at `body >`, so a top-level div is not every div', () => {
    document.body.innerHTML = '<div><p>one</p></div><div><p>two</p></div>';
    const second = document.querySelectorAll('p')[1];
    const picked = pick(second);
    expect(picked.chordId).toBeNull();
    expect(picked.selector).toBe('body > div:nth-of-type(2) > p');
    expect([...document.querySelectorAll(picked.selector)]).toEqual([second]);
    expect(pick(document.querySelector('div')!).selector).toBe('body > div:nth-of-type(1)');
  });

  it('stops at a unique id and does not anchor at the body then', () => {
    document.body.innerHTML = '<div></div><section id="main"><p>x</p></section>';
    expect(pick(document.querySelector('p')!).selector).toBe('section#main > p');
  });

  it('keeps the specific tail of an over-long path, dropping the body anchor with the rest', () => {
    let html = '<span>leaf</span>';
    for (let depth = 0; depth < 120; depth += 1) html = `<div><i></i><div>${html}</div></div>`;
    document.body.innerHTML = html;
    const { selector } = pick(document.querySelector('span')!);
    expect(selector.length).toBeLessThanOrEqual(MAX_PICKED_SELECTOR_LENGTH);
    expect(selector.startsWith('body')).toBe(false);
    expect(selector.endsWith('> span')).toBe(true);
  });

  it('reports the nearest source location stamped on the element or an ancestor', () => {
    document.body.innerHTML =
      '<section data-chord-src="app/page.tsx:12:5"><button data-chord-src="ui/button.tsx:3:3"><b>Go</b></button></section>';
    const inner = pick(document.querySelector('b')!);
    expect(inner.sourceLocation).toBe('ui/button.tsx:3:3');
    expect(inner.sourceLocationOf).toBe('ancestor');
    const button = pick(document.querySelector('button')!);
    expect(button.sourceLocation).toBe('ui/button.tsx:3:3');
    expect(button.sourceLocationOf).toBe('element');
    document.body.innerHTML = '<p>plain</p>';
    const plain = pick(document.querySelector('p')!);
    expect(plain.sourceLocation).toBeNull();
    expect(plain.sourceLocationOf).toBeNull();
  });
});
