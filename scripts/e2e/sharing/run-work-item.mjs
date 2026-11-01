import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { waitFor } from './sharing-accounts.mjs';

/** Cheap, and enough for the chat to exist and be published like any other. */
const OPENING = 'This is an automated Chord test. Reply with one word: ready.';

/**
 * What the run's work item left in the repository: its lane's checkout and
 * branch, and a ref per checkpoint (named by checkpoint, so only the app knows
 * which are this item's). Read while the app is open; removed after it exits,
 * once its agent no longer holds the checkout.
 */
async function recordDiskTraces(author, workItemId, repoPath) {
  const { items } = await author.call('workItems.getAll');
  const row = items.find((w) => w.id === workItemId);
  const { checkpoints } = await author.call('checkpoints.list', workItemId);
  const refs = checkpoints.map((c) => c.gitRef);
  const git = (...args) => execFileSync('git', ['-C', repoPath, ...args], { stdio: 'pipe' });
  return async () => {
    if (row?.repoPath && row.repoPath !== repoPath && existsSync(row.repoPath)) {
      git('worktree', 'remove', '--force', row.repoPath);
    }
    if (row?.branchName) git('branch', '-D', row.branchName);
    for (const ref of refs) git('update-ref', '-d', ref);
  };
}

/**
 * The run's own work item, created the way the app creates one: a new item
 * on one of the owner's repositories, and an opening message that starts its
 * chat. Nothing of it outlives the run: not the cloud row, nor its checkout,
 * branch or checkpoint refs in the repository (deleting a work item keeps its
 * branch, since a person's work may live there; a test run's never does).
 *
 * The suites used to borrow the first synced item of the seed's that the
 * teammate could not see, a real one ("Improving the resume"): every run added
 * its messages to that item's synced history, where they stayed (user report,
 * 2026-10-02).
 */
export async function createRunWorkItem({ author, stamp, cleanup }) {
  const { repos } = await author.call('repos.getAll');
  const repo = repos.find((r) => !r.archivedAt && existsSync(r.path));
  if (!repo)
    throw new Error('The author profile has no repository on disk for the run’s work item');

  const { item } = await author.call('workItems.create', {
    name: `Chord e2e ${stamp}`,
    repoId: repo.id,
  });
  // In the cloud at the end of the run; on disk as the author's app closes,
  // which some suites do midway (the checks after it read only the cloud).
  cleanup.add('delete the run’s work item in the cloud', async () => {
    const res = await author.api('DELETE', `/work-items/${item.id}`);
    if (![200, 204, 404].includes(res.status)) {
      throw new Error(`cloud delete answered ${res.status} ${JSON.stringify(res.body)}`);
    }
  });
  author.onClose({ before: () => recordDiskTraces(author, item.id, repo.path) });
  await author.call('chatMessages.sendToAgent', { workItemId: item.id, content: OPENING });

  let ready = null;
  await waitFor(
    async () => {
      const { items } = await author.call('workItems.getAll');
      ready = items.find((w) => w.id === item.id) ?? null;
      if (ready?.provisionStatus !== 'ready' || !existsSync(ready.repoPath)) return false;
      return (await author.api('GET', `/work-items/${item.id}`)).status === 200;
    },
    180_000,
    'the run’s work item to be checked out and synced'
  );
  return ready;
}
