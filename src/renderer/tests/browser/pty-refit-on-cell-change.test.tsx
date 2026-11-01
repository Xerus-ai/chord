/**
 * A terminal re-fits when its cell size changes after it was fitted, in real
 * Chromium with the real PtyPane → usePty → FrontendPty (xterm) stack.
 *
 * usePty fits the terminal at mount and on a resize of its pane. The cell
 * size can change afterwards with no resize: the user's terminal font setting
 * is applied asynchronously after mount (`use-pty.ts`), the app's mono
 * webfont can arrive after the first fit (`pty.ts`'s fonts.ready re-measure),
 * and the display scale can change. The terminal kept its column count with
 * the wider cells and drew past the pane's edge — agent-terminals-02 (run
 * 1791064279844): Claude Code's status line cut at the right edge.
 *
 * Only the Electron preload bridge (`window.electronAPI`) is supplied: it is
 * the process boundary; it records `pty.resize` and answers the terminal
 * settings read. Tailwind is not compiled in this runner, so the utilities
 * these components use are declared below, in Tailwind's order.
 */
import { FitAddon } from '@xterm/addon-fit';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

type Invocation = { channel: string; args: unknown[] };
const invocations: Invocation[] = [];

/** What `appSettings.get('terminal')` answers, and when; set per test. */
let terminalSettings: Promise<{ fontFamily?: string }> = Promise.resolve({});

Object.assign(window, {
  electronAPI: {
    invoke: async (channel: string, ...args: unknown[]) => {
      invocations.push({ channel, args });
      if (channel === 'appSettings.get') return args[0] === 'terminal' ? terminalSettings : {};
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

/** A wider monospace face than the default stack resolves to in this runner. */
const WIDER_FONT = 'Courier New';

/**
 * The font setting changes only the family, and at 13 px every installed
 * monospace face rounds to the same 7 px cell here. The setting is free text,
 * so a face whose glyphs are far wider stands in for "a wider font". The
 * terminal quotes the family it is given (`buildFontFamily`), so a generic
 * keyword never resolves; a named proportional face is needed, and none is
 * installed on every host (Verdana on Windows, DejaVu Sans on Linux CI). The
 * first candidate that is installed is used: a missing face measures the same
 * as the fallback it is paired with, an installed one measures as itself.
 */
const WIDE_CELL_CANDIDATES = ['Verdana', 'DejaVu Sans', 'Liberation Sans', 'Arial'];

function measureGlyph(family: string): number {
  const context = document.createElement('canvas').getContext('2d');
  if (!context) throw new Error('no 2d canvas context');
  context.font = `13px ${family}`;
  return context.measureText('W').width;
}

function isInstalled(family: string): boolean {
  return measureGlyph(`'${family}', monospace`) !== measureGlyph('monospace');
}

function wideCellFamily(): string {
  const family = WIDE_CELL_CANDIDATES.find(isInstalled);
  if (!family) throw new Error(`none of ${WIDE_CELL_CANDIDATES.join(', ')} is installed`);
  return family;
}

type Pty = InstanceType<typeof FrontendPty>;

function resizesSentTo(sessionId: string): { cols: number; rows: number }[] {
  return invocations
    .filter((call) => call.channel === 'pty.resize' && call.args[0] === sessionId)
    .map((call) => ({ cols: call.args[1] as number, rows: call.args[2] as number }));
}

function cellOf(pty: Pty): { width: number; height: number } {
  const core = (
    pty.terminal as unknown as {
      _core: {
        _renderService: { dimensions: { css: { cell: { width: number; height: number } } } };
      };
    }
  )._core;
  return { ...core._renderService.dimensions.css.cell };
}

/** The drawn grid's pixel size against the box it must fit in. */
function geometryOf(pty: Pty) {
  const screen = pty.terminal.element?.querySelector('.xterm-screen') as HTMLElement;
  const drawn = screen.getBoundingClientRect();
  return {
    drawnWidth: drawn.width,
    drawnHeight: drawn.height,
    boxWidth: pty.ownedContainer.clientWidth,
    boxHeight: pty.ownedContainer.clientHeight,
  };
}

/** Long enough for a rAF, the ResizeObserver and the 120 ms resize debounce. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

const ptys: Pty[] = [];
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function renderTerminal(pty: Pty) {
  host = document.createElement('div');
  Object.assign(host.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: '800px',
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

function openTerminal(sessionId: string): Pty {
  const pty = new FrontendPty(sessionId);
  ptys.push(pty);
  return pty;
}

/** Fitted: the grid fills the box, and the PTY was told that size. */
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
}

/** What xterm's FitAddon would size this terminal to (it leaves room for the scrollbar). */
function proposedByFitAddon(pty: Pty): { cols: number; rows: number } {
  const fit = new FitAddon();
  pty.terminal.loadAddon(fit);
  const proposed = fit.proposeDimensions();
  fit.dispose();
  if (!proposed) throw new Error('FitAddon proposed no size for a mounted terminal');
  return proposed;
}

/** The grid fits its box at the current cell size, sized as FitAddon sizes it. */
function expectFitted(pty: Pty) {
  const g = geometryOf(pty);
  expect(g.drawnWidth).toBeLessThanOrEqual(g.boxWidth);
  expect(g.drawnHeight).toBeLessThanOrEqual(g.boxHeight);
  expect({ cols: pty.terminal.cols, rows: pty.terminal.rows }).toEqual(proposedByFitAddon(pty));
  expect(resizesSentTo(pty.sessionId).at(-1)).toEqual({
    cols: pty.terminal.cols,
    rows: pty.terminal.rows,
  });
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  for (const pty of ptys.splice(0)) pty.dispose();
  invocations.length = 0;
  terminalSettings = Promise.resolve({});
});

describe('a fitted terminal whose cell size changes', () => {
  it('re-fits to its pane when its font gets wider, and tells the PTY', async () => {
    const pty = openTerminal('session:wider-font');
    renderTerminal(pty);
    await waitForFit(pty);
    await settle();
    const before = { cols: pty.terminal.cols, cell: cellOf(pty) };

    // The cell widens with no resize of the pane (as when the mono webfont arrives).
    pty.terminal.options.fontFamily = `'${WIDER_FONT}', monospace`;
    pty.terminal.options.fontSize = 14;
    await settle();

    expect(cellOf(pty).width).toBeGreaterThan(before.cell.width);
    expect(pty.terminal.cols).toBeLessThan(before.cols);
    expectFitted(pty);
  });

  it('re-fits when the terminal font setting arrives after the first fit', async () => {
    let answer!: (settings: { fontFamily?: string }) => void;
    terminalSettings = new Promise((resolve) => (answer = resolve));
    const pty = openTerminal('session:font-setting');
    renderTerminal(pty);
    await waitForFit(pty);
    await settle();
    const before = { cols: pty.terminal.cols, cell: cellOf(pty) };

    // The settings read answers only now, after the mount's fit.
    answer({ fontFamily: wideCellFamily() });
    await settle();

    expect(cellOf(pty).width).toBeGreaterThan(before.cell.width);
    expectFitted(pty);
  });
});
