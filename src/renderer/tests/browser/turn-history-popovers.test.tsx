/**
 * The turn footer's Reset confirm and Fork menu open over the rows after
 * their turn, and must take the click there. The transcript renders each row
 * absolutely positioned and translated (`transcript-list.tsx`), so a later
 * row stacks above an earlier one: on 2026-10-06 the history e2e
 * (devstation-b4p.4) found the confirm drawn but its Reset button under the
 * next row, which took the click. Rows here are styled as the transcript's;
 * the real components render in real Chromium with the app's CSS.
 */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ResetTurnControl } from '@renderer/features/work-list/reset-turn-control';
import { TurnForkMenu } from '@renderer/features/work-list/turn-fork-menu';
import '@renderer/index.css';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

/** `footer` in the first row, and a tall second row starting just under it, as in the transcript. */
function renderInRows(footer: ReactNode): void {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  const row = (start: number, children: ReactNode) => (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: '100%',
        transform: `translateY(${start}px)`,
      }}
      className="flex flex-col"
    >
      {children}
    </div>
  );
  flushSync(() =>
    root!.render(
      <div style={{ position: 'relative', width: 600, height: 600 }}>
        {row(0, <div className="group/turn flex items-center gap-3">{footer}</div>)}
        {row(
          24,
          <div style={{ height: 500 }} className="text-content tracking-body text-text">
            The next turn&apos;s text.
          </div>
        )}
      </div>
    )
  );
}

afterEach(() => {
  root?.unmount();
  root = null;
  host?.remove();
  host = null;
});

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
}

function findButton(name: string, role = 'button'): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>(`[role="${role}"], button`)].find(
    (el) =>
      el.textContent?.trim() === name && (role === 'button' || el.getAttribute('role') === role)
  );
  if (!found) throw new Error(`no "${name}" ${role} in: ${document.body.textContent}`);
  return found;
}

/** What a click at the element's centre lands on: the element itself, or something over it. */
function takesTheClick(element: HTMLElement): boolean {
  const box = element.getBoundingClientRect();
  const hit = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
  return hit !== null && element.contains(hit);
}

describe('turn footer popovers over later rows', () => {
  it("the Reset confirm's Reset button takes the click", async () => {
    renderInRows(
      <ResetTurnControl
        agentName="Claude Code"
        mode="full"
        laterTurns={1}
        waitReason={null}
        onReset={async () => {}}
      />
    );

    findButton('Reset to here').click();
    await settle();

    expect(takesTheClick(findButton('Reset'))).toBe(true);
  });

  it("the Fork menu's items take the click", async () => {
    renderInRows(
      <TurnForkMenu onForkToNewTab={async () => {}} onForkToNewWorktree={async () => {}} />
    );

    document.querySelector<HTMLButtonElement>('button[aria-label="More for this turn"]')!.click();
    await settle();

    expect(takesTheClick(findButton('Fork to new tab', 'menuitem'))).toBe(true);
    expect(takesTheClick(findButton('Fork to new worktree', 'menuitem'))).toBe(true);
  });
});
