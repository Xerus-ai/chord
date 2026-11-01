/**
 * A turn footer's history controls (plan §"Decisions for Phase 5",
 * Visibility): Reset and the Fork menu show only where they can run;
 * otherwise one line says why. The real footer renders in real Chromium.
 */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentTurn } from '@shared/stream-items';
import { TurnFooter } from '@renderer/features/work-list/turn-footer';
import type { TurnHistoryAction } from '@renderer/features/work-list/turn-history-actions';
import '@renderer/index.css';

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

const TURN: AgentTurn = {
  id: 'turn-1',
  workItemId: 'wi-1',
  agentName: 'Claude Code',
  items: [{ kind: 'text', id: 'text-1', text: 'Done.' }],
  status: 'complete',
  timestamp: 100,
  sessionId: 'sess-1',
};

function footer(history: TurnHistoryAction): HTMLDivElement {
  return render(
    <TurnFooter
      turn={TURN}
      artifacts={[]}
      workItemId="wi-1"
      workspaceRoot={null}
      history={history}
    />
  );
}

describe('TurnFooter history', () => {
  it('says in one line why a turn has no Reset', () => {
    const view = footer({
      reset: null,
      forkToNewTab: null,
      forkToNewWorktree: null,
      unavailable: "No checkpoint was saved for this turn, so it can't be reset or forked.",
    });

    expect(view.textContent).toContain(
      "No checkpoint was saved for this turn, so it can't be reset or forked."
    );
    expect(view.querySelector('button[aria-label="More for this turn"]')).toBeNull();
  });

  it('shows the Fork menu and the line together when only Reset is missing', () => {
    const view = footer({
      reset: null,
      forkToNewTab: async () => {},
      forkToNewWorktree: null,
      unavailable: "No checkpoint was saved for this turn, so it can't be reset.",
    });

    expect(view.textContent).toContain(
      "No checkpoint was saved for this turn, so it can't be reset."
    );
    expect(view.querySelector('button[aria-label="More for this turn"]')).not.toBeNull();
  });
});
