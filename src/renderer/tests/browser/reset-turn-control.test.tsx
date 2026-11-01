/**
 * The turn footer's Reset (plan §"Decisions for Phase 5", Reset to here): the
 * confirm states what happens to the files, the agent's memory and commits;
 * an agent Chord cannot fork (ACP, or a turn with no history point) gets
 * "Reset files to here" and is told it keeps its memory; while the agent is
 * working, one line says why Reset waits. A failed reset says why in place.
 *
 * The real component renders in real Chromium with the app's CSS; its confirm
 * is a portal, so it is read from the document.
 */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ResetTurnControl } from '@renderer/features/work-list/reset-turn-control';
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

function button(container: HTMLElement, name: string): HTMLButtonElement {
  const found = [...container.querySelectorAll('button')].find(
    (b) => b.textContent?.trim() === name
  );
  if (!found) throw new Error(`no "${name}" button in: ${container.textContent}`);
  return found;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('ResetTurnControl', () => {
  it('confirms a full reset with what happens to files, memory and commits, then resets', async () => {
    const calls: string[] = [];
    render(
      <ResetTurnControl
        agentName="Claude"
        mode="full"
        laterTurns={2}
        waitReason={null}
        onReset={async () => {
          calls.push('reset');
        }}
      />
    );

    flushSync(() => button(document.body, 'Reset to here').click());
    const text = document.body.textContent ?? '';
    expect(text).toContain('Files go back to how they were after this turn');
    expect(text).toContain('Current files are saved as a checkpoint first');
    expect(text).toContain('Claude forgets the 2 turns after it');
    expect(text).toContain('Commits made since stay on the branch');

    flushSync(() => button(document.body, 'Reset').click());
    await settle();
    expect(calls).toEqual(['reset']);
  });

  it('says "the turn" for one later turn', () => {
    render(
      <ResetTurnControl
        agentName="Codex"
        mode="full"
        laterTurns={1}
        waitReason={null}
        onReset={async () => {}}
      />
    );
    flushSync(() => button(document.body, 'Reset to here').click());
    expect(document.body.textContent).toContain('Codex forgets the turn after it');
  });

  it('offers files only to an agent Chord cannot rewind, saying it keeps its memory', () => {
    render(
      <ResetTurnControl
        agentName="Qwen"
        mode="files"
        laterTurns={3}
        waitReason={null}
        onReset={async () => {}}
      />
    );

    flushSync(() => button(document.body, 'Reset files to here').click());
    const text = document.body.textContent ?? '';
    expect(text).toContain('Files go back to how they were after this turn');
    expect(text).toContain('Qwen keeps its memory of later turns');
    expect(text).not.toContain('forgets');
  });

  it('waits while the agent is working, saying why', () => {
    render(
      <ResetTurnControl
        agentName="Claude"
        mode="full"
        laterTurns={1}
        waitReason="Reset is available when Claude finishes"
        onReset={async () => {}}
      />
    );

    expect(button(document.body, 'Reset to here').disabled).toBe(true);
    expect(document.body.textContent).toContain('Reset is available when Claude finishes');
  });

  it('shows why a reset failed and offers it again', async () => {
    render(
      <ResetTurnControl
        agentName="Claude"
        mode="full"
        laterTurns={1}
        waitReason={null}
        onReset={async () => {
          throw new Error('This lane is archived.');
        }}
      />
    );

    flushSync(() => button(document.body, 'Reset to here').click());
    flushSync(() => button(document.body, 'Reset').click());
    await settle();
    await settle();

    expect(document.body.textContent).toContain('This lane is archived.');
    expect(button(document.body, 'Reset to here').disabled).toBe(false);
  });

  // The Reset's own marker lands while it runs, and the turn's later turns
  // drop to 0 under the open confirm (history-codex e2e, devstation-b4p.4).
  it('keeps saying what the Reset will do while it runs', async () => {
    let finish: () => void = () => {};
    const confirm = (laterTurns: number) => (
      <ResetTurnControl
        agentName="Codex"
        mode="full"
        laterTurns={laterTurns}
        waitReason={null}
        onReset={() => new Promise<void>((resolve) => (finish = resolve))}
      />
    );
    render(confirm(1));
    flushSync(() => button(document.body, 'Reset to here').click());
    flushSync(() => button(document.body, 'Reset').click());

    flushSync(() => root!.render(confirm(0)));

    expect(document.body.textContent).toContain('Codex forgets the turn after it');
    expect(document.body.textContent).not.toContain('already ends at this turn');
    finish();
    await settle();
  });

  it('cancels back to the button', async () => {
    render(
      <ResetTurnControl
        agentName="Claude"
        mode="full"
        laterTurns={1}
        waitReason={null}
        onReset={async () => {}}
      />
    );

    flushSync(() => button(document.body, 'Reset to here').click());
    flushSync(() => button(document.body, 'Cancel').click());
    // The confirm fades out before it unmounts.
    await vi.waitFor(() => expect(document.body.textContent).not.toContain('Files go back'));
    button(document.body, 'Reset to here');
  });
});
