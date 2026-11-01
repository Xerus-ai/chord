/**
 * The work list shows the item last requested through its navigation params.
 * Navigation applies params in a transition (`lib/layout/provider.tsx`), and
 * React throws away a transition render that an urgent update interrupts —
 * state set during that render goes with it. Seen 2026-10-07 (devstation-cz3a):
 * Create opened a new work item while another was shown, the sidebar updated
 * urgently mid-transition, and the old item stayed on screen for good.
 *
 * Here the transition render is kept open by slow siblings rendered after the
 * panel, and the first of them schedules a store update read by an unrelated
 * component, which interrupts it once the panel has already adopted the id.
 */
import { startTransition, useEffect, useState, useSyncExternalStore } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useRequestedSelection } from '@renderer/features/work-list/use-requested-selection';

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let requestId: (id: string | null) => void = () => {};
let interruptScheduled = false;

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
  interruptScheduled = false;
  tick = 0;
});

function Shown({ incomingId }: { incomingId: string | null }) {
  const selectedId = useRequestedSelection(incomingId);
  return <p data-testid="shown">{selectedId}</p>;
}

/** Long enough that the scheduler yields between two of these. */
function SlowSibling({ slow }: { slow: boolean }) {
  if (slow) {
    if (!interruptScheduled) {
      interruptScheduled = true;
      setTimeout(() => bumpTicker(), 0);
    }
    const end = performance.now() + 10;
    while (performance.now() < end) {
      // Busy: this render takes 10ms.
    }
  }
  return null;
}

/** Stands for the navigation provider: params set in a transition. */
function Navigation({ onRequest }: { onRequest: (request: (id: string | null) => void) => void }) {
  const [incomingId, setIncomingId] = useState<string | null>('item-a');
  useEffect(() => onRequest((id) => startTransition(() => setIncomingId(id))), [onRequest]);
  const slow = incomingId !== 'item-a';
  return (
    <>
      <Shown incomingId={incomingId} />
      {Array.from({ length: 30 }, (_, index) => (
        <SlowSibling key={index} slow={slow} />
      ))}
    </>
  );
}

/**
 * Stands for the app's zustand stores (modal, center tabs): an external store
 * read with `useSyncExternalStore`, whose updates render synchronously — the
 * kind of update that interrupts a transition (a default-priority setState
 * does not).
 */
let tick = 0;
const tickListeners = new Set<() => void>();
function bumpTicker() {
  tick += 1;
  for (const listener of tickListeners) listener();
}
function subscribeTick(listener: () => void) {
  tickListeners.add(listener);
  return () => tickListeners.delete(listener);
}

function Ticker() {
  const value = useSyncExternalStore(subscribeTick, () => tick);
  return <span data-testid="tick">{value}</span>;
}

function shownId(): string | null | undefined {
  return host?.querySelector('[data-testid="shown"]')?.textContent;
}

function renderApp(): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const onRequest = (request: (id: string | null) => void) => {
    requestId = request;
  };
  flushSync(() =>
    root!.render(
      <>
        <Navigation onRequest={onRequest} />
        <Ticker />
      </>
    )
  );
}

describe('useRequestedSelection', () => {
  it('shows a requested item even when an urgent update interrupts the navigation', async () => {
    renderApp();
    expect(shownId()).toBe('item-a');

    requestId('item-b');
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(host?.querySelector('[data-testid="tick"]')?.textContent).toBe('1');
    expect(shownId()).toBe('item-b');
  });

  it('keeps the selection when the request is cleared', async () => {
    renderApp();
    requestId('item-b');
    await new Promise((resolve) => setTimeout(resolve, 1_500));
    requestId(null);
    await new Promise((resolve) => setTimeout(resolve, 1_500));

    expect(shownId()).toBe('item-b');
  });
});
