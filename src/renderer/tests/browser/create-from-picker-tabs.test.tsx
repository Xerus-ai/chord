/**
 * The Create from… picker's tabs (devstation-10g). In create-from-picker
 * e2e shot 09, after Issues was clicked the Issues panel showed while
 * "Pull requests" carried the filled pill. Here the real picker lays out in
 * real Chromium and the tabs are switched with a real pointer, as the user
 * (and the e2e) does: the tab whose panel is shown is the one that reads
 * selected, and only it — at once. The pills faded over 150 ms
 * (transition-colors) while the panel switched instantly, so for the first
 * frames the strip still showed the previous tab selected (measured in the
 * live app: Issues transparent, Pull requests 0.075 at the screenshot,
 * correct 300 ms later).
 *
 * Only the Electron preload bridge is supplied, as the module graph reads it
 * at load; with no repository chosen the picker asks the main process for
 * nothing, so any call fails the test.
 */
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';
import '@renderer/index.css';

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string) => {
      throw new Error(`the picker asked the main process for ${channel}`);
    },
    eventOn: () => () => {},
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

// The app's theme: the surface tokens are defined under it (index.css).
document.documentElement.classList.add('chord-dark');

const { CreateFromPicker } = await import('@renderer/features/create-work-item/create-from-picker');

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

function renderPicker(): HTMLElement {
  host = document.createElement('div');
  host.style.width = '480px';
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root!.render(<CreateFromPicker repoId={null} onPick={() => {}} />));
  return host;
}

function tab(container: HTMLElement, name: string): HTMLElement {
  const found = [...container.querySelectorAll('[role="tab"]')].find(
    (element) => element.textContent?.trim() === name
  );
  if (!found) throw new Error(`no tab ${name}`);
  return found as HTMLElement;
}

const fill = (element: HTMLElement) => getComputedStyle(element).backgroundColor;
const isTransparent = (color: string) => color === 'rgba(0, 0, 0, 0)' || color === 'transparent';

describe('Create from… tabs', () => {
  it('fills only the tab whose panel is shown, after switching with the pointer', async () => {
    const picker = renderPicker();

    await userEvent.click(tab(picker, 'Pull requests'));
    const selectedFill = fill(tab(picker, 'Pull requests'));
    await userEvent.click(tab(picker, 'Issues'));

    // Read in the same frame as the switch, as a screenshot would.
    expect(picker.querySelector('[role="tabpanel"]')?.getAttribute('aria-label')).toBe('Issues');
    expect(tab(picker, 'Issues').getAttribute('aria-selected')).toBe('true');
    expect(tab(picker, 'Pull requests').getAttribute('aria-selected')).toBe('false');
    expect(fill(tab(picker, 'Issues'))).toBe(selectedFill);
    expect(isTransparent(fill(tab(picker, 'Pull requests')))).toBe(true);
  });

  it('keeps the tabs at their type size: the selected one is not larger than the rest', async () => {
    const picker = renderPicker();
    await userEvent.click(tab(picker, 'Branches'));

    const size = (name: string) => getComputedStyle(tab(picker, name)).fontSize;
    expect(size('Branches')).toBe(size('Issues'));
  });
});
