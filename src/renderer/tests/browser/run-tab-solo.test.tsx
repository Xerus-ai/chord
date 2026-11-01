/**
 * The Run tab's Solo controls and the sidebar's Solo line (plan §"Decisions
 * for Phase 4", Slot + queue and Run tab): "Solo this branch" on a free slot,
 * "Queue (n ahead)" on a taken one, "Leave queue" while queued; while this
 * lane holds the root, where it runs, Sync from lane and Release; refusals in
 * the panel itself with their files — a dirty root says to commit or stash
 * in the root, a root changed during Solo offers "Discard and release" as an
 * explicit second step; an interrupted Solo offers Restore. The repo header
 * names the holder's work item, its branch on hover, and focuses it, or
 * offers Restore.
 *
 * The real components render in real Chromium; the state they get is the
 * shape the main process returns (`@shared/solo`).
 */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SoloActionError, SoloLaneRef, SoloView } from '@shared/solo';
import { SoloHeaderLine } from '@renderer/features/app-sidebar/solo-header-line';
import { describeSoloHeader } from '@renderer/features/app-sidebar/solo-header-model';
import { SoloControls } from '@renderer/features/right-rail/run/solo-controls';
import '@renderer/index.css';

const ROOT = 'C:/repos/app';

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

function lane(laneId: string): SoloLaneRef {
  const name = laneId.slice('lane-'.length);
  return {
    laneId,
    workItemId: `item-${name}`,
    workItemName: `Item ${name}`,
    branch: `chord/${name}`,
  };
}

function view(overrides: Partial<SoloView> = {}): SoloView {
  return {
    repoId: 'repo-1',
    rootPath: ROOT,
    holder: null,
    queue: [],
    interrupted: null,
    ...overrides,
  };
}

const held = (laneId: string, queue: string[] = []) =>
  view({ holder: { ...lane(laneId), since: '2026-10-04T10:00:00.000Z' }, queue: queue.map(lane) });

function button(container: HTMLElement, name: string): HTMLButtonElement | undefined {
  return [...container.querySelectorAll('button')].find(
    (b) => (b.getAttribute('aria-label') ?? b.textContent?.trim()) === name
  );
}

function handlers() {
  return { onSolo: vi.fn(), onLeaveQueue: vi.fn(), onSync: vi.fn(), onRelease: vi.fn() };
}

function renderControls(
  solo: SoloView,
  options: { error?: SoloActionError | null; pending?: boolean } = {}
) {
  const on = handlers();
  const container = render(
    <SoloControls
      solo={solo}
      laneId="lane-a"
      error={options.error ?? null}
      pending={options.pending ?? false}
      {...on}
    />
  );
  return { container, on };
}

function listedFiles(container: HTMLElement): string[] {
  return [...container.querySelectorAll('li')].map((item) => item.textContent?.trim() ?? '');
}

describe('SoloControls', () => {
  it('offers Solo this branch on a free slot, with the compose help, and nothing else', () => {
    const { container, on } = renderControls(view());

    button(container, 'Solo this branch')!.click();

    expect(on.onSolo).toHaveBeenCalledTimes(1);
    expect(container.textContent).toContain('docker compose up --remove-orphans');
    expect(button(container, 'Release')).toBeUndefined();
    expect(button(container, 'Sync from lane')).toBeUndefined();
    expect(button(container, 'Start')).toBeUndefined();
  });

  it('offers to queue behind a holder, naming it', () => {
    const { container, on } = renderControls(held('lane-b'));

    expect(container.textContent).toContain('Item b is soloing on chord/b');
    button(container, 'Queue (1 ahead)')!.click();

    expect(on.onSolo).toHaveBeenCalledTimes(1);
  });

  it('offers Leave queue while queued', () => {
    const { container, on } = renderControls(held('lane-b', ['lane-a']));

    expect(container.textContent).toContain('Queued · 1 ahead');
    button(container, 'Leave queue')!.click();

    expect(on.onLeaveQueue).toHaveBeenCalledTimes(1);
  });

  it('while holding: where it runs, Sync from lane, and Release (keeping root changes)', () => {
    const { container, on } = renderControls(held('lane-a'));

    expect(container.textContent).toContain(`Soloing in ${ROOT}`);
    expect(button(container, 'Solo this branch')).toBeUndefined();
    button(container, 'Sync from lane')!.click();
    button(container, 'Release')!.click();

    expect(on.onSync).toHaveBeenCalledTimes(1);
    expect(on.onRelease).toHaveBeenCalledWith(false);
    expect(button(container, 'Discard and release')).toBeUndefined();
  });

  it('lists a dirty root and says to commit or stash in the root, offering no discard', () => {
    const { container } = renderControls(view(), {
      error: { type: 'root_dirty', files: ['dirty.md', 'src/x.ts'] },
    });

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toContain(`Commit or stash these in ${ROOT} first`);
    expect(listedFiles(container)).toEqual(['dirty.md', 'src/x.ts']);
    expect(button(container, 'Discard and release')).toBeUndefined();
  });

  it('lists a root changed during Solo and offers Discard and release as its own step', () => {
    const { container, on } = renderControls(held('lane-a'), {
      error: { type: 'root_changed', files: ['scratch.md'] },
    });

    expect(listedFiles(container)).toEqual(['scratch.md']);
    button(container, 'Discard and release')!.click();

    expect(on.onRelease).toHaveBeenCalledWith(true);
  });

  it('shows an interrupted Solo with its files, and Restore releases without discarding', () => {
    const { container, on } = renderControls(
      view({ interrupted: { laneId: 'lane-b', branch: 'chord/b', files: ['scratch.md'] } })
    );

    expect(container.textContent).toContain('Solo of chord/b was interrupted');
    expect(listedFiles(container)).toEqual(['scratch.md']);
    expect(button(container, 'Solo this branch')).toBeUndefined();
    button(container, 'Restore')!.click();

    expect(on.onRelease).toHaveBeenCalledWith(false);
  });

  it('disables its buttons while an action is on its way', () => {
    const { container } = renderControls(held('lane-a'), { pending: true });

    expect(button(container, 'Release')!.disabled).toBe(true);
    expect(button(container, 'Sync from lane')!.disabled).toBe(true);
  });
});

describe('SoloHeaderLine', () => {
  it("names the holder's work item and the queue, its branch on hover; clicking focuses the holder's work item", () => {
    const onFocusWorkItem = vi.fn();
    const onRestore = vi.fn();
    const model = describeSoloHeader(held('lane-a', ['lane-b']))!;
    const container = render(
      <SoloHeaderLine model={model} onFocusWorkItem={onFocusWorkItem} onRestore={onRestore} />
    );

    const line = button(container, 'Soloing Item a · 1 queued')!;
    expect(line.title).toBe('Soloing Item a on chord/a · 1 queued');
    line.click();

    expect(onFocusWorkItem).toHaveBeenCalledWith('item-a');
    expect(onRestore).not.toHaveBeenCalled();
  });

  it('keeps the queue count whole in a narrow sidebar, cutting the work item name instead', () => {
    // solo-docker e2e (2026-10-05, shot 03): a long name truncated "· 1 queued" away.
    const solo = view({
      holder: {
        ...lane('lane-a'),
        workItemName: 'Chord e2e solo A 1791144021558 with a long work item name',
        since: '2026-10-04T10:00:00.000Z',
      },
      queue: [lane('lane-b')],
    });
    const container = render(
      <div style={{ width: 240 }}>
        <SoloHeaderLine
          model={describeSoloHeader(solo)!}
          onFocusWorkItem={vi.fn()}
          onRestore={vi.fn()}
        />
      </div>
    );

    const line = container.querySelector('button')!;
    const queued = [...line.querySelectorAll('span')].find(
      (span) => span.textContent === ' · 1 queued'
    )!;
    const name = [...line.querySelectorAll('span')].find((span) =>
      span.textContent?.startsWith('Soloing Chord e2e')
    )!;
    expect(queued.getBoundingClientRect().right).toBeLessThanOrEqual(
      container.getBoundingClientRect().right
    );
    expect(queued.scrollWidth).toBeLessThanOrEqual(queued.clientWidth);
    expect(name.scrollWidth).toBeGreaterThan(name.clientWidth);
  });

  it('shows Solo interrupted with Restore', () => {
    const onFocusWorkItem = vi.fn();
    const onRestore = vi.fn();
    const model = describeSoloHeader(
      view({ interrupted: { laneId: 'lane-a', branch: 'chord/a', files: ['x.md'] } })
    )!;
    const container = render(
      <SoloHeaderLine model={model} onFocusWorkItem={onFocusWorkItem} onRestore={onRestore} />
    );

    expect(container.textContent).toContain('Solo interrupted');
    button(container, 'Restore')!.click();

    expect(onRestore).toHaveBeenCalledTimes(1);
    expect(onFocusWorkItem).not.toHaveBeenCalled();
  });
});
