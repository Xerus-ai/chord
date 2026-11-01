/**
 * measureDimensions() on a container that is not laid out (devstation-1b9,
 * devstation-8x9), in real Chromium.
 *
 * A retained tab that is not shown is kept mounted under the `hidden` class
 * (`retained-panel.tsx`), i.e. inside a `display: none` subtree, and a
 * retained body can be detached while no pane shows it. Per CSSOM, such an
 * element's resolved `width`/`height` is its COMPUTED value, not a used pixel
 * size — `'100%'` for the terminal's own container (`pty.ts`) — and parsing
 * that as pixels gave a 100 × 100 px "terminal": 13 columns, 6 rows. A
 * container with no layout box has no size to measure: the answer is null.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { measureDimensions } from '@renderer/lib/pty/pty-dimensions';

const CW = 8;
const CH = 16;

const created: HTMLElement[] = [];

function sizedBox(width: string, height: string, parent: HTMLElement = document.body) {
  const el = document.createElement('div');
  el.style.width = width;
  el.style.height = height;
  parent.appendChild(el);
  if (parent === document.body) created.push(el);
  return el;
}

afterEach(() => {
  for (const el of created.splice(0)) el.remove();
});

describe('measureDimensions on a container that is not laid out', () => {
  it('is null for a percentage-sized container inside a hidden (display: none) tab', () => {
    const tab = sizedBox('800px', '400px');
    tab.style.display = 'none';
    const terminalBox = sizedBox('100%', '100%', tab);

    // Chromium resolves these to the computed '100%', not pixels.
    expect(getComputedStyle(terminalBox).width).toBe('100%');
    expect(measureDimensions(terminalBox, CW, CH)).toBeNull();
  });

  it('is null for a pixel-sized container that is itself display: none', () => {
    const terminalBox = sizedBox('800px', '400px');
    terminalBox.style.display = 'none';

    expect(measureDimensions(terminalBox, CW, CH)).toBeNull();
  });

  it('is null for a container detached from the document', () => {
    const detached = document.createElement('div');
    detached.style.width = '100%';
    detached.style.height = '100%';

    expect(measureDimensions(detached, CW, CH)).toBeNull();
  });

  it('measures pixels, not the percentage, once the hidden tab is shown again', () => {
    const tab = sizedBox('800px', '400px');
    tab.style.display = 'none';
    const terminalBox = sizedBox('100%', '100%', tab);
    expect(measureDimensions(terminalBox, CW, CH)).toBeNull();

    tab.style.display = 'block';

    expect(measureDimensions(terminalBox, CW, CH)).toEqual({
      cols: Math.floor(800 / CW),
      rows: Math.floor(400 / CH),
    });
  });

  it('measures a container laid out through a display: contents wrapper (a retained body)', () => {
    const pane = sizedBox('800px', '400px');
    const body = document.createElement('div');
    body.style.display = 'contents';
    pane.appendChild(body);
    const terminalBox = sizedBox('100%', '100%', body);

    expect(measureDimensions(terminalBox, CW, CH)).toEqual({
      cols: Math.floor(800 / CW),
      rows: Math.floor(400 / CH),
    });
  });
});
