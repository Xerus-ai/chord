// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { CHORD_ID_ATTRIBUTE } from '@shared/artifact-frame-constants';
import type { FrameToHostMessage } from '@shared/artifact-frame-messages';
import { createTextEditing } from './page-text-editing';

/**
 * Edit text in place is the default for an owner's web page (shared-items
 * step 1, S6): a single click still reaches the page, a double-click edits.
 */
beforeAll(() => {
  Element.prototype.getBoundingClientRect = () =>
    ({ x: 0, y: 0, left: 0, top: 0, right: 10, bottom: 10, width: 10, height: 10 }) as DOMRect;
});

// Every instance a test enabled is disabled after it: an enabled instance
// keeps its document listeners, which would edit the next test's elements.
const enabled: { disable: () => void }[] = [];

afterEach(() => {
  for (const editing of enabled.splice(0)) editing.disable();
  document.body.innerHTML = '';
  document.head.innerHTML = '';
});

function setup() {
  document.body.innerHTML = `<a href="#next"><span ${CHORD_ID_ATTRIBUTE}="cta">Start free</span></a><p id="built"></p><div ${CHORD_ID_ATTRIBUTE}="gen"></div>`;
  (document.getElementById('built') as HTMLElement).textContent = 'Made by a script';
  // Stamped, but empty in the source: its copy is a script's (d3822b4 stamps every pickable element).
  const filled = document.querySelector(`[${CHORD_ID_ATTRIBUTE}="gen"]`) as HTMLElement;
  filled.textContent = 'Filled by a script';
  const posted: FrameToHostMessage[] = [];
  const editing = createTextEditing((message) => posted.push(message));
  enabled.push(editing);
  // The host lists the elements that are text in the source (editable-text-ids.ts).
  editing.enable(['cta']);
  return {
    posted,
    editing,
    cta: document.querySelector(`[${CHORD_ID_ATTRIBUTE}="cta"]`) as HTMLElement,
    built: document.getElementById('built') as HTMLElement,
    filled,
  };
}

function mouse(type: 'click' | 'dblclick', target: Element): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(event);
  return event;
}

describe('createTextEditing', () => {
  it('a single click reaches the page: nothing becomes editable, the link is not blocked', () => {
    const { cta } = setup();
    const event = mouse('click', cta);
    expect(event.defaultPrevented).toBe(false);
    expect(cta.hasAttribute('contenteditable')).toBe(false);
  });

  it('a double-click makes a stamped text element editable', () => {
    const { cta } = setup();
    mouse('dblclick', cta);
    expect(cta.getAttribute('contenteditable')).toBe('plaintext-only');
  });

  it('while an element is being edited, clicks inside it do not follow the link', () => {
    const { cta } = setup();
    mouse('dblclick', cta);
    expect(mouse('click', cta).defaultPrevented).toBe(true);
  });

  it('leaving the element commits the edit and ends editing', () => {
    const { cta, posted } = setup();
    mouse('dblclick', cta);
    cta.textContent = 'Try it free';
    cta.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    expect(posted).toEqual([
      { type: 'chord:text-edit', chordId: 'cta', originalText: 'Start free', text: 'Try it free' },
    ]);
    expect(cta.hasAttribute('contenteditable')).toBe(false);
  });

  it('a double-click on copy that cannot be edited here says where to take it', () => {
    const { built } = setup();
    mouse('dblclick', built);
    expect(built.hasAttribute('contenteditable')).toBe(false);
    const hint = document.getElementById('chord-runtime-edit-hint') as HTMLElement;
    expect(hint.style.display).toBe('block');
  });

  it('a stamped element the source has no text in is not editable, and says so', () => {
    const { filled } = setup();
    mouse('dblclick', filled);
    expect(filled.hasAttribute('contenteditable')).toBe(false);
    const hint = document.getElementById('chord-runtime-edit-hint') as HTMLElement;
    expect(hint.style.display).toBe('block');
  });

  it('enabling again with a new list changes which elements edit', () => {
    const { cta, editing } = setup();
    editing.enable([]);
    mouse('dblclick', cta);
    expect(cta.hasAttribute('contenteditable')).toBe(false);
  });

  it('disable ends an edit in progress by committing it', () => {
    const { cta, posted, editing } = setup();
    mouse('dblclick', cta);
    cta.textContent = 'Changed';
    editing.disable();
    expect(cta.hasAttribute('contenteditable')).toBe(false);
    expect(posted).toEqual([
      { type: 'chord:text-edit', chordId: 'cta', originalText: 'Start free', text: 'Changed' },
    ]);
  });
});
