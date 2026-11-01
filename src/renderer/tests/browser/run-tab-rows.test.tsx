/**
 * The Run tab's rows (plan §Phase 4, Run tab): one row per run script with
 * its status, the actions that status allows, its URL opening externally,
 * a start refusal shown in the row itself, and its terminal on demand; and
 * the empty state that links to Repo › Run & test.
 *
 * The real components render in real Chromium; the run state they get is
 * the shape the main process returns (`@shared/lane-runs`).
 */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RunScriptState } from '@shared/lane-runs';
import { RunEmptyState } from '@renderer/features/right-rail/run/run-empty-state';
import { RunScriptRow } from '@renderer/features/right-rail/run/run-script-row';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(node: ReactNode): HTMLDivElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root!.render(node));
  return host;
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

function state(overrides: Partial<RunScriptState>): RunScriptState {
  return {
    status: 'stopped',
    exitCode: null,
    startedAt: null,
    url: null,
    ptySessionId: null,
    ...overrides,
  };
}

function button(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name
  );
}

function handlers() {
  return {
    onStart: vi.fn(),
    onStop: vi.fn(),
    onRestart: vi.fn(),
    onOpenUrl: vi.fn(),
    renderTerminal: (sessionId: string) => <div data-testid="terminal">{sessionId}</div>,
  };
}

describe('RunScriptRow', () => {
  it('shows a script that never ran as Stopped, with Start only', () => {
    const on = handlers();
    const view = render(
      <RunScriptRow title="web" state={undefined} error={null} pending={false} {...on} />
    );

    const row = view.querySelector('[role="group"][aria-label="web"]');
    expect(row).not.toBeNull();
    expect(row!.textContent).toContain('Stopped');
    expect(button(view, 'Stop')).toBeUndefined();
    expect(button(view, 'Restart')).toBeUndefined();
    // Nothing ran, so there is no terminal to show.
    expect(button(view, 'Show terminal')).toBeUndefined();
    button(view, 'Start')!.click();
    expect(on.onStart).toHaveBeenCalledTimes(1);
  });

  it('shows the URL of a running script and opens it externally', () => {
    const on = handlers();
    const view = render(
      <RunScriptRow
        title="web"
        state={state({ status: 'running', url: 'http://localhost:50010', ptySessionId: 'pty-web' })}
        error={null}
        pending={false}
        {...on}
      />
    );

    expect(button(view, 'Start')).toBeUndefined();
    button(view, 'http://localhost:50010')!.click();
    expect(on.onOpenUrl).toHaveBeenCalledWith('http://localhost:50010');
    button(view, 'Stop')!.click();
    button(view, 'Restart')!.click();
    expect(on.onStop).toHaveBeenCalledTimes(1);
    expect(on.onRestart).toHaveBeenCalledTimes(1);
  });

  it('shows a start refusal in the row, and disables the actions while one is pending', () => {
    const view = render(
      <RunScriptRow
        title="Run"
        state={undefined}
        error="Setup is still running, so dependencies may be missing. Start again once it finishes."
        pending
        {...handlers()}
      />
    );

    expect(view.querySelector('[role="alert"]')!.textContent).toBe(
      'Setup is still running, so dependencies may be missing. Start again once it finishes.'
    );
    expect(button(view, 'Start')!.disabled).toBe(true);
  });

  it("shows the script's terminal on demand, after it ran", () => {
    const view = render(
      <RunScriptRow
        title="web"
        state={state({ status: 'exited', exitCode: 1, ptySessionId: 'pty-web' })}
        error={null}
        pending={false}
        {...handlers()}
      />
    );

    expect(view.textContent).toContain('Exited 1');
    expect(view.querySelector('[data-testid="terminal"]')).toBeNull();
    const toggle = button(view, 'Show terminal')!;
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    flushSync(() => toggle.click());
    expect(view.querySelector('[data-testid="terminal"]')!.textContent).toBe('pty-web');
    expect(button(view, 'Hide terminal')!.getAttribute('aria-expanded')).toBe('true');
  });
});

describe('RunEmptyState', () => {
  it('says the repository has no scripts and links to set them up', () => {
    const onSetUp = vi.fn();
    const view = render(<RunEmptyState onSetUp={onSetUp} />);

    expect(view.textContent).toContain('This repository has no run or test script.');
    button(view, 'Set up Run & test')!.click();
    expect(onSetUp).toHaveBeenCalledTimes(1);
  });
});
