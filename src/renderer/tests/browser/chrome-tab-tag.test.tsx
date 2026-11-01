/**
 * A session tab off the primary lane names its lane after its title
 * ("Claude Code (fork) · fork", devstation-6z9s). With three tabs the label
 * was truncated as one string, so the lane tag was the part cut off
 * ("Claude Code (for…") and the tab read like its neighbour (devstation-w366).
 * The title truncates; the tag stays whole.
 *
 * The real component lays out in real Chromium, in a strip too narrow for the
 * whole label.
 */
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ChromeTab } from '@renderer/lib/components/chrome/chrome-tabs';
import '@renderer/index.css';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

function renderNarrowTab(): HTMLElement {
  host = document.createElement('div');
  host.style.display = 'flex';
  host.style.width = '150px';
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() =>
    root!.render(
      <ChromeTab icon={<span>•</span>} label="Claude Code (fork)" tag="fork" active={false} />
    )
  );
  return host.querySelector('[role="tab"]') as HTMLElement;
}

describe('ChromeTab tag', () => {
  it('keeps the tag whole and inside the tab when the title does not fit', () => {
    const tab = renderNarrowTab();
    const tag = tab.querySelector('[data-tab-tag]') as HTMLElement | null;

    expect(tag?.textContent).toBe('· fork');
    const tabBox = tab.getBoundingClientRect();
    const tagBox = tag!.getBoundingClientRect();
    expect(tagBox.width).toBeGreaterThan(0);
    expect(tagBox.right).toBeLessThanOrEqual(tabBox.right + 0.5);
    expect(tag!.scrollWidth).toBeLessThanOrEqual(tag!.clientWidth);

    const label = [...tab.querySelectorAll('span')].find(
      (span) => span.textContent === 'Claude Code (fork)'
    );
    expect(label!.scrollWidth).toBeGreaterThan(label!.clientWidth);
  });
});
