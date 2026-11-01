/**
 * The turn footer's "…" menu (plan §"Decisions for Phase 5", Fork): "Fork to
 * new tab" starts a new chat of the same agent from this turn, and "Fork to
 * new worktree" does so on a new lane made from the turn's checkpoint. A
 * failed fork says why in place. The real component renders in real Chromium.
 */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TurnForkMenu } from '@renderer/features/work-list/turn-fork-menu';
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

function byLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const found = container.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`no button labelled "${label}"`);
  return found;
}

function menuItem(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find(
    (item) => item.textContent?.trim() === name
  );
  if (!found) throw new Error(`no "${name}" item in: ${container.textContent}`);
  return found;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('TurnForkMenu', () => {
  it('forks to a new tab from the menu, then closes it', async () => {
    const calls: string[] = [];
    const view = render(
      <TurnForkMenu
        onForkToNewTab={async () => {
          calls.push('fork');
        }}
      />
    );

    expect(document.querySelector('[role="menu"]')).toBeNull();
    flushSync(() => byLabel(view, 'More for this turn').click());
    flushSync(() => menuItem(document.body, 'Fork to new tab').click());
    await settle();
    await settle();

    expect(calls).toEqual(['fork']);
    // The menu fades out before it unmounts.
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  });

  it('forks to a new worktree from the menu when the turn has a checkpoint', async () => {
    const calls: string[] = [];
    const view = render(
      <TurnForkMenu
        onForkToNewTab={async () => {
          calls.push('tab');
        }}
        onForkToNewWorktree={async () => {
          calls.push('worktree');
        }}
      />
    );

    flushSync(() => byLabel(view, 'More for this turn').click());
    flushSync(() => menuItem(document.body, 'Fork to new worktree').click());
    await settle();
    await settle();

    expect(calls).toEqual(['worktree']);
    await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull());
  });

  it('offers only Fork to new tab when the turn has no checkpoint', () => {
    const view = render(<TurnForkMenu onForkToNewTab={async () => {}} />);

    flushSync(() => byLabel(view, 'More for this turn').click());

    const items = [...document.querySelectorAll('[role="menuitem"]')].map((item) =>
      item.textContent?.trim()
    );
    expect(items).toEqual(['Fork to new tab']);
  });

  it('says why a fork failed', async () => {
    const view = render(
      <TurnForkMenu
        onForkToNewTab={async () => {
          throw new Error("This turn's lane is archived.");
        }}
      />
    );

    flushSync(() => byLabel(view, 'More for this turn').click());
    flushSync(() => menuItem(document.body, 'Fork to new tab').click());
    await settle();
    await settle();

    expect(view.textContent).toContain("This turn's lane is archived.");
  });
});
