/**
 * A terminal leaves room for xterm's overlay scrollbar, in real Chromium with
 * the real PtyPane → usePty → FrontendPty (xterm) stack (devstation-iyx).
 *
 * xterm draws its vertical scrollbar over the right edge of the viewport, so
 * xterm's own FitAddon takes the scrollbar's width off the space it fits
 * columns into. usePty measured the whole width: the grid ran under the
 * scrollbar, which covered its last columns whenever it showed.
 *
 * FitAddon is the reference: it is loaded into the terminal only to ask what
 * size it proposes, after usePty has fitted. Only the Electron preload bridge
 * (`window.electronAPI`) is supplied: it is the process boundary, and it
 * records the `pty.resize` calls the main process would receive. Tailwind is
 * not compiled in this runner, so the utilities these components use are
 * declared below, in Tailwind's order.
 */
import { FitAddon } from '@xterm/addon-fit';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type Invocation = { channel: string; args: unknown[] };
const invocations: Invocation[] = [];

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args });
      if (channel === 'appSettings.get') return {};
      return { success: true, data: undefined };
    },
    eventOn: () => () => {},
    eventSend: () => {},
    getPathForFile: () => '',
  },
});

const { FrontendPty } = await import('@renderer/lib/pty/pty');
const { PtyPane } = await import('@renderer/lib/pty/pty-pane');
const { RetainedPanel } = await import('@renderer/features/work-list/retained-panel');

const TAILWIND_UTILITIES = `
  .flex { display: flex; }
  .flex-col { flex-direction: column; }
  .flex-1 { flex: 1 1 0%; }
  .min-h-0 { min-height: 0; }
  .min-w-0 { min-width: 0; }
  .h-full { height: 100%; }
  .w-full { width: 100%; }
  .overflow-hidden { overflow: hidden; }
  .p-2 { padding: 0.5rem; }
  .hidden { display: none; }
`;

beforeAll(() => {
  const style = document.createElement('style');
  style.textContent = TAILWIND_UTILITIES;
  document.head.appendChild(style);
});

type Pty = InstanceType<typeof FrontendPty>;

function resizesSentTo(sessionId: string): { cols: number; rows: number }[] {
  return invocations
    .filter((call) => call.channel === 'pty.resize' && call.args[0] === sessionId)
    .map((call) => ({ cols: call.args[1] as number, rows: call.args[2] as number }));
}

/** What xterm's FitAddon would size this terminal to. */
function proposedByFitAddon(pty: Pty): { cols: number; rows: number } {
  const fit = new FitAddon();
  pty.terminal.loadAddon(fit);
  const proposed = fit.proposeDimensions();
  fit.dispose();
  if (!proposed) throw new Error('FitAddon proposed no size for a mounted terminal');
  return proposed;
}

function verticalScrollbarOf(pty: Pty): HTMLElement {
  const bar = pty.terminal.element?.querySelector<HTMLElement>(
    '.xterm-scrollable-element > .scrollbar.vertical'
  );
  if (!bar) throw new Error('xterm rendered no vertical scrollbar element');
  return bar;
}

/** Long enough for a rAF, the ResizeObserver and the 120 ms resize debounce. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

const ptys: Pty[] = [];
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderTerminal(pty: Pty, width: number) {
  host = document.createElement('div');
  Object.assign(host.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: `${width}px`,
    height: '400px',
    display: 'flex',
    flexDirection: 'column',
  });
  document.body.appendChild(host);
  root = createRoot(host);
  root.render(
    createElement(RetainedPanel, {
      active: true,
      children: createElement(PtyPane, { sessionId: pty.sessionId, pty }),
    })
  );
}

async function waitForFit(pty: Pty) {
  await vi.waitFor(
    () => {
      expect(resizesSentTo(pty.sessionId).at(-1)).toEqual({
        cols: pty.terminal.cols,
        rows: pty.terminal.rows,
      });
    },
    { timeout: 5_000 }
  );
  await settle();
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  for (const pty of ptys.splice(0)) pty.dispose();
  invocations.length = 0;
});

describe('a fitted terminal and its overlay scrollbar', () => {
  it.each([800, 640, 1013])(
    'at %i px is sized as FitAddon sizes it, and the PTY is told that size',
    async (width) => {
      const pty = new FrontendPty(`session:scrollbar-${width}`);
      ptys.push(pty);
      renderTerminal(pty, width);
      await waitForFit(pty);

      const proposed = proposedByFitAddon(pty);
      expect({ cols: pty.terminal.cols, rows: pty.terminal.rows }).toEqual(proposed);
      expect(resizesSentTo(pty.sessionId).at(-1)).toEqual(proposed);
    }
  );

  it('draws no column under the scrollbar', async () => {
    const pty = new FrontendPty('session:scrollbar-overlap');
    ptys.push(pty);
    renderTerminal(pty, 800);
    await waitForFit(pty);

    // Enough output to scroll, so the scrollbar has something to show.
    for (let line = 0; line < 200; line++) pty.terminal.write(`line ${line}\r\n`);
    await settle();

    const screen = pty.terminal.element?.querySelector('.xterm-screen') as HTMLElement;
    const drawnRight = screen.getBoundingClientRect().right;
    const bar = verticalScrollbarOf(pty).getBoundingClientRect();
    expect(bar.width).toBeGreaterThan(0);
    expect(drawnRight).toBeLessThanOrEqual(bar.left);
  });
});
