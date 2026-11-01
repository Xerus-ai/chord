// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { computeDocxZoom, fitDocxPagesToFrame, fitDocxPagesWhenLaidOut } from './docx-page-fit';

/**
 * A docx page rendered by docx-preview keeps its paper width (a Letter page
 * is 612pt = 816px, plus the wrapper's 30px padding each side), so in a frame
 * narrower than that it overflowed sideways (devstation-5e8). The viewer
 * scales the wrapper down to the frame instead: whole page visible, aspect
 * kept, never scaled up.
 */

const LETTER_PT = 612;
const LETTER_PX = LETTER_PT * (96 / 72);
const WRAPPER_PADDING = 30;

function renderedWrapper(pageWidths: string[]): HTMLElement {
  document.body.innerHTML = '';
  const wrapper = document.createElement('div');
  wrapper.className = 'docx-wrapper';
  wrapper.style.padding = `${WRAPPER_PADDING}px`;
  for (const width of pageWidths) {
    const page = document.createElement('section');
    page.className = 'docx';
    page.style.width = width;
    wrapper.appendChild(page);
  }
  document.body.appendChild(wrapper);
  return wrapper;
}

describe('computeDocxZoom', () => {
  it('leaves a page that fits at its size, never scales up', () => {
    expect(computeDocxZoom(1200, 876)).toBe(1);
    expect(computeDocxZoom(876, 876)).toBe(1);
  });

  it('scales a wider page down so it fits the frame exactly', () => {
    expect(computeDocxZoom(700, 876)).toBeCloseTo(700 / 876, 6);
  });

  it('refuses widths that cannot be measured', () => {
    expect(() => computeDocxZoom(0, 876)).toThrow(/frame width/);
    expect(() => computeDocxZoom(700, 0)).toThrow(/page width/);
  });
});

describe('fitDocxPagesToFrame', () => {
  it('fits a Letter page into a narrower frame with room for the wrapper padding', () => {
    const wrapper = renderedWrapper([`${LETTER_PT}.00pt`]);
    const zoom = fitDocxPagesToFrame(wrapper, 700);
    const contentWidth = LETTER_PX + 2 * WRAPPER_PADDING;
    expect(zoom).toBeCloseTo(700 / contentWidth, 6);
    expect(Number(wrapper.style.getPropertyValue('zoom'))).toBeCloseTo(zoom, 6);
    expect(contentWidth * zoom).toBeLessThanOrEqual(700);
  });

  it('fits to the widest page of a mixed document', () => {
    const wrapper = renderedWrapper([`${LETTER_PT}.00pt`, '1000px']);
    const zoom = fitDocxPagesToFrame(wrapper, 800);
    expect(zoom).toBeCloseTo(800 / (1000 + 2 * WRAPPER_PADDING), 6);
  });

  it('measures again from the unscaled page, so a widened frame restores full size', () => {
    const wrapper = renderedWrapper([`${LETTER_PT}.00pt`]);
    fitDocxPagesToFrame(wrapper, 700);
    expect(fitDocxPagesToFrame(wrapper, 1400)).toBe(1);
    expect(wrapper.style.getPropertyValue('zoom')).toBe('1');
  });

  it('waits for a frame that is not laid out yet instead of failing the render', () => {
    const wrapper = renderedWrapper([`${LETTER_PT}.00pt`]);
    expect(fitDocxPagesWhenLaidOut(wrapper, 0)).toBeNull();
    expect(wrapper.style.getPropertyValue('zoom')).toBe('');
    expect(fitDocxPagesWhenLaidOut(wrapper, 700)).toBeCloseTo(
      700 / (LETTER_PX + 2 * WRAPPER_PADDING),
      6
    );
    expect(() => fitDocxPagesToFrame(wrapper, 0)).toThrow(/no width/);
  });

  it('fails loudly when nothing was rendered', () => {
    const wrapper = renderedWrapper([]);
    expect(() => fitDocxPagesToFrame(wrapper, 700)).toThrow(/no pages/);
  });
});
