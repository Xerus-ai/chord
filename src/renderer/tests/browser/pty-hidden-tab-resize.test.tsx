/**
 * A terminal tab that is hidden and shown again keeps its size, in real
 * Chromium with the real PtyPane → usePty → FrontendPty (xterm) →
 * RetainedPanel stack (devstation-1b9, devstation-8x9).
 *
 * A retained tab that is not shown stays mounted under the `hidden` class
 * (display: none). Its ResizeObserver fires when it is hidden; measuring a
 * container that has no layout box read the computed '100%' as 100 px, so the
 * terminal shrank to ~13 × 6 and that size went to the PTY. The shell then
 * re-wrapped its prompt into 13 columns and scrolled its start out of a
 * 6-row screen, and showing the tab again could not bring either back:
 *   - pr-per-lane-04: after a PR chip switched lanes, the revealed lane's
 *     prompt wrapped every 13 characters;
 *   - left-rail-lanes-10: after the other tab closed, the surviving
 *     terminal's prompt began mid-path ("l-lanes\chord-e2e-…>").
 *
 * Only the Electron preload bridge (`window.electronAPI`) is supplied: it is
 * the process boundary, and it records the `pty.resize` calls the main
 * process would receive. Tailwind is not compiled in this runner, so the
 * utilities these components use are declared below as Tailwind defines them.
 */
import { createElement, type ReactNode } from 'react';
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

// In Tailwind's order: `hidden` comes after `flex`, so a panel with both is hidden.
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

/** Every size the main process was asked to give this PTY, in order. */
function resizesSentTo(sessionId: string): { cols: number; rows: number }[] {
  return invocations
    .filter((call) => call.channel === 'pty.resize' && call.args[0] === sessionId)
    .map((call) => ({ cols: call.args[1] as number, rows: call.args[2] as number }));
}

/** Long enough for the ResizeObserver, its rAF and the 120 ms resize debounce to have run. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 500));

const ptys: InstanceType<typeof FrontendPty>[] = [];
let root: Root | null = null;
let host: HTMLDivElement | null = null;

function openTerminal(sessionId: string) {
  const pty = new FrontendPty(sessionId);
  ptys.push(pty);
  return pty;
}

/** The center pane: 800 × 400 px, one retained panel per tab, as `RetainedBodyHost` renders them. */
function renderTabs(tabs: { pty: InstanceType<typeof FrontendPty>; active: boolean }[]) {
  if (!host) {
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
  }
  const children: ReactNode[] = tabs.map(({ pty, active }) =>
    createElement(RetainedPanel, {
      key: pty.sessionId,
      active,
      children: createElement(PtyPane, { sessionId: pty.sessionId, pty }),
    })
  );
  root!.render(children);
}

/** The size the terminal settles at while shown in the 800 × 400 pane. */
async function settleShown(pty: InstanceType<typeof FrontendPty>) {
  await vi.waitFor(
    () => {
      const sent = resizesSentTo(pty.sessionId);
      expect(sent.length).toBeGreaterThan(0);
      expect(sent.at(-1)).toEqual({ cols: pty.terminal.cols, rows: pty.terminal.rows });
    },
    { timeout: 5_000 }
  );
  const shown = { cols: pty.terminal.cols, rows: pty.terminal.rows };
  // Sanity: the pane is wide; this is nowhere near the 13-column failure.
  expect(shown.cols).toBeGreaterThan(60);
  expect(shown.rows).toBeGreaterThan(15);
  return shown;
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  for (const pty of ptys.splice(0)) pty.dispose();
  invocations.length = 0;
});

describe('a retained terminal tab that is hidden and shown again', () => {
  it('keeps its size, and sends the PTY nothing smaller, while hidden', async () => {
    const pty = openTerminal('session:hide-reveal');
    renderTabs([{ pty, active: true }]);
    const shown = await settleShown(pty);
    const sentBeforeHiding = resizesSentTo(pty.sessionId).length;

    // Another tab is shown (e.g. a PR chip switched the work item's lane).
    renderTabs([{ pty, active: false }]);
    await settle();

    expect({ cols: pty.terminal.cols, rows: pty.terminal.rows }).toEqual(shown);
    expect(resizesSentTo(pty.sessionId).slice(sentBeforeHiding)).toEqual([]);

    // Shown again: still the pane's size.
    renderTabs([{ pty, active: true }]);
    await settle();
    expect({ cols: pty.terminal.cols, rows: pty.terminal.rows }).toEqual(shown);
    for (const sent of resizesSentTo(pty.sessionId)) expect(sent).toEqual(shown);
  });

  it('survives the other tab closing: the revealed terminal never had a narrower size', async () => {
    const survivor = openTerminal('session:survivor');
    renderTabs([{ pty: survivor, active: true }]);
    const shown = await settleShown(survivor);

    // A second terminal opens and takes the pane; the first is hidden.
    const other = openTerminal('session:other');
    renderTabs([
      { pty: survivor, active: false },
      { pty: other, active: true },
    ]);
    await settleShown(other);
    await settle();

    // The second tab closes; the first is shown again.
    renderTabs([{ pty: survivor, active: true }]);
    await settle();

    expect({ cols: survivor.terminal.cols, rows: survivor.terminal.rows }).toEqual(shown);
    for (const sent of resizesSentTo(survivor.sessionId)) expect(sent).toEqual(shown);
  });

  it('mounted while hidden, sends no size until shown, then the pane’s', async () => {
    const visible = openTerminal('session:visible');
    renderTabs([{ pty: visible, active: true }]);
    const shown = await settleShown(visible);

    // A tab retained in the background from the start (restored, or opened behind).
    const background = openTerminal('session:background');
    renderTabs([
      { pty: visible, active: true },
      { pty: background, active: false },
    ]);
    await settle();
    expect(resizesSentTo(background.sessionId)).toEqual([]);

    renderTabs([
      { pty: visible, active: false },
      { pty: background, active: true },
    ]);
    await vi.waitFor(() => expect(resizesSentTo(background.sessionId).length).toBeGreaterThan(0), {
      timeout: 5_000,
    });
    await settle();
    for (const sent of resizesSentTo(background.sessionId)) expect(sent).toEqual(shown);
    expect({ cols: background.terminal.cols, rows: background.terminal.rows }).toEqual(shown);
  });
});
