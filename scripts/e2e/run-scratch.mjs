/**
 * What an e2e run makes for itself and removes again: a scratch repository
 * for its work items, and the cloud copy of an item it made. `workItems.remove`
 * removes the item from the app (its checkouts with it), not from the cloud.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import dotenv from 'dotenv';
import { ROOT } from './seeded-app.mjs';

dotenv.config({ path: join(ROOT, '.env'), quiet: true });

/**
 * A git repository of one commit in tmp, at one stable path per label,
 * recreated each run: the app keeps a folder per repository under
 * ~/chord/worktrees, so a fresh name every run would leave a new empty one
 * behind each time (devstation-aje).
 *
 * @param {string} label
 * @param {Record<string, string>} files relative path → contents
 */
export function createScratchRepo(label, files) {
  const dir = join(tmpdir(), `chord-${label}-repo`);
  removeScratchRepo(dir);
  mkdirSync(dir, { recursive: true });
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, name)), { recursive: true });
    writeFileSync(join(dir, name), body);
  }
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'ignore' });
  git('init', '-q', '-b', 'main');
  git('add', '-A');
  git('-c', 'user.email=e2e@chord.test', '-c', 'user.name=Chord e2e', 'commit', '-qm', 'init');
  return dir;
}

/** Deletes a scratch repository; retried, since Windows may still hold a file in it briefly. */
export function removeScratchRepo(dir) {
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
}

function cloudApiUrl(path) {
  const base = process.env.CHORD_CLOUD_API_URL?.trim();
  if (!base) throw new Error(`CHORD_CLOUD_API_URL is not set (${join(ROOT, '.env')})`);
  return `${base.replace(/\/+$/, '')}${path}`;
}

/**
 * Deletes a work item the run made from the cloud, as the run's signed-in
 * account. `rpc` is the instance's raw IPC call (`launchSeededApp().rpc`).
 */
export async function deleteWorkItemFromCloud(rpc, workItemId) {
  const token = await rpc('account.getAccessToken');
  if (typeof token !== 'string' || !token) throw new Error('The run has no access token');
  const res = await fetch(cloudApiUrl(`/work-items/${workItemId}`), {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  // 404: the item never reached the cloud, or the app's own delete got there first.
  if (![200, 204, 404].includes(res.status)) {
    throw new Error(`Cloud delete of ${workItemId} answered ${res.status} ${await res.text()}`);
  }
}
