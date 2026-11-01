/**
 * Archive and Restore in the left rail (plan §"Decisions for Phase 5"): the
 * archive confirm says what is kept and, for a merged lane, offers "Also
 * delete the branch" (checked); archived lanes sit in an "Archived (n)" group
 * under the work item, each with Restore and Delete, or Delete only once its
 * branch is gone. Real components in real Chromium.
 */
import type { ReactNode } from 'react';
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { ArchiveLaneDialog } from '@renderer/features/app-sidebar/archive-lane-dialog';
import { ArchivedLanesGroup } from '@renderer/features/app-sidebar/archived-lanes-group';
import { Dialog } from '@renderer/lib/ui/dialog';
import '@renderer/index.css';

let root: Root | null = null;
let host: HTMLDivElement | null = null;

function render(node: ReactNode): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  flushSync(() => root!.render(node));
  return document.body;
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

describe('ArchiveLaneDialog', () => {
  function renderDialog(offerBranchDelete: boolean, results: Array<{ deleteBranch: boolean }>) {
    return render(
      <Dialog open>
        <ArchiveLaneDialog
          title="Archive raghav/fix--2?"
          description="Removes this branch's checkout from this machine."
          offerBranchDelete={offerBranchDelete}
          onSuccess={(result) => results.push(result)}
          onClose={() => {}}
        />
      </Dialog>
    );
  }

  it('offers to delete a merged branch, checked, and archives with it', async () => {
    const results: Array<{ deleteBranch: boolean }> = [];
    const view = renderDialog(true, results);

    const box = view.querySelector<HTMLInputElement>('input[type="checkbox"]');
    expect(box?.checked).toBe(true);
    expect(view.textContent).toContain('Also delete the branch');
    flushSync(() => button(view, 'Archive').click());
    await settle();
    expect(results).toEqual([{ deleteBranch: true }]);
  });

  it('keeps the branch when unchecked', async () => {
    const results: Array<{ deleteBranch: boolean }> = [];
    const view = renderDialog(true, results);

    flushSync(() => view.querySelector<HTMLInputElement>('input[type="checkbox"]')?.click());
    flushSync(() => button(view, 'Archive').click());
    await settle();
    expect(results).toEqual([{ deleteBranch: false }]);
  });

  it('has no branch option for a lane whose branch must stay', async () => {
    const results: Array<{ deleteBranch: boolean }> = [];
    const view = renderDialog(false, results);

    expect(view.querySelector('input[type="checkbox"]')).toBeNull();
    flushSync(() => button(view, 'Archive').click());
    await settle();
    expect(results).toEqual([{ deleteBranch: false }]);
  });
});

describe('ArchivedLanesGroup', () => {
  const lanes = [
    {
      id: 'lane-2',
      branchName: 'raghav/fix--2',
      title: 'retry flow',
      restorable: true,
      keptChanges: 2,
    },
    { id: 'lane-3', branchName: 'raghav/fix--3', title: null, restorable: false, keptChanges: 0 },
  ];

  it('shows the count, then each lane with Restore and Delete, or Delete only', () => {
    const view = render(
      <ArchivedLanesGroup lanes={lanes} onRestore={async () => {}} onDelete={() => {}} />
    );

    expect(view.textContent).toContain('Archived (2)');
    expect(view.textContent).not.toContain('retry flow');
    flushSync(() => button(view, 'Archived (2)').click());

    const rows = [...view.querySelectorAll('[data-archived-lane]')];
    expect(rows.map((row) => row.getAttribute('data-archived-lane'))).toEqual(['lane-2', 'lane-3']);
    expect(rows[0].textContent).toContain('retry flow');
    expect(rows[0].textContent).toContain('2 uncommitted files kept');
    button(rows[0] as HTMLElement, 'Restore');
    button(rows[0] as HTMLElement, 'Delete');
    expect(rows[1].textContent).toContain('Branch deleted, nothing to restore');
    expect([...rows[1].querySelectorAll('button')].map((b) => b.textContent?.trim())).toEqual([
      'Delete',
    ]);
  });

  it('restores a lane, and says why a restore failed', async () => {
    const restored: string[] = [];
    const view = render(
      <ArchivedLanesGroup
        lanes={lanes}
        onRestore={async (laneId) => {
          restored.push(laneId);
          throw new Error('The branch is checked out somewhere else.');
        }}
        onDelete={() => {}}
      />
    );
    flushSync(() => button(view, 'Archived (2)').click());
    const row = view.querySelector<HTMLElement>('[data-archived-lane="lane-2"]') as HTMLElement;

    flushSync(() => button(row, 'Restore').click());
    await settle();
    await settle();

    expect(restored).toEqual(['lane-2']);
    expect(row.textContent).toContain('The branch is checked out somewhere else.');
  });

  it('renders nothing without archived lanes', () => {
    const view = render(
      <ArchivedLanesGroup lanes={[]} onRestore={async () => {}} onDelete={() => {}} />
    );
    expect(view.textContent).not.toContain('Archived');
  });
});
