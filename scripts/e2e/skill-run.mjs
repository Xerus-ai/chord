/**
 * The app a skill script drives (.claude/skills/checkpoint-e2e,
 * claude-session-e2e): the built app (`out/`, electron-vite build) on a
 * throw-away profile seeded from a signed-in one (`launchSeededApp`), and the
 * work items the run makes removed again when it closes — from the app (its
 * checkout with it) and from the cloud. The scripts used to launch on the
 * shell's profile and keep a named item there for good, so the seed
 * chord-p1-smoke filled with "Checkpoint E2E", "Claude Session E2E" and
 * "Terminal PTY E2E" items that its teammate saw for months (devstation-mcs).
 *
 *   const run = await launchSkillRun({ profilePrefix: 'chord-session-e2e' });
 *   const repoPath = run.createScratchRepo('session-e2e');
 *   const item = await run.createRunWorkItem({ name: 'Claude Session E2E', repoPath, ... });
 *   … run.rpc / run.page …
 *   await run.close();
 */
import { existsSync } from 'node:fs';
import { createScratchRepo, deleteWorkItemFromCloud, removeScratchRepo } from './run-scratch.mjs';
import { launchSeededApp } from './seeded-app.mjs';

/**
 * @param {{ profilePrefix: string, env?: Record<string, string> }} options
 */
export async function launchSkillRun({ profilePrefix, env = {} }) {
  // `out/` by default; CHORD_E2E_APP_DIR points at a build of its own (build-e2e-app.mjs).
  const instance = await launchSeededApp({ source: 'built', profilePrefix, env });
  const createdIds = [];
  const scratchRepos = [];

  /** RPC as a Result: `data` on success, a throw naming the channel otherwise. */
  async function rpc(channel, ...args) {
    const result = await instance.rpc(channel, ...args);
    if (!result || result.success !== true) {
      throw new Error(`RPC ${channel} failed: ${JSON.stringify(result)}`);
    }
    return result.data;
  }

  return {
    app: instance.app,
    page: instance.page,
    /** The raw IPC answer, for a check that expects a refusal. */
    rpcRaw: instance.rpc,
    rpc,
    session: instance.session,
    readStdout: instance.readStdout,
    readStderr: instance.readStderr,
    /**
     * A git repository of one commit in tmp, for a work item that needs one
     * (every work item does) but whose run touches no real repo. Deleted
     * after the app closes.
     */
    createScratchRepo(label) {
      const dir = createScratchRepo(label, { 'README.md': `# ${label}\n` });
      scratchRepos.push(dir);
      return dir;
    },
    /**
     * Opens a work item in the window the way a chord:// link does, and waits
     * for its header — what a person sees, whatever the profile restored.
     */
    async openWorkItem(workItemId) {
      await instance.app.evaluate(({ app }, link) => {
        app.emit('second-instance', {}, [process.execPath, link], process.cwd());
      }, `chord://open/work-item/${workItemId}`);
      await instance.page
        .locator('[data-testid="work-item-header"]')
        .first()
        .waitFor({ timeout: 60_000 });
    },
    /**
     * The work item's checkout once the app has made it: a new item gets a
     * worktree of its own, so its agent and its reverts act there, not in the
     * repository it was created from.
     */
    async waitForCheckout(workItemId) {
      const deadline = Date.now() + 120_000;
      while (Date.now() < deadline) {
        const { items } = await rpc('workItems.getAll');
        const item = items.find((w) => w.id === workItemId);
        if (item?.provisionStatus === 'ready' && existsSync(item.repoPath)) return item.repoPath;
        if (item?.provisionStatus === 'failed') {
          throw new Error(`Work item ${workItemId} failed to provision`);
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      throw new Error(`Work item ${workItemId} was not checked out within 120 s`);
    },
    /** `workItems.create`, remembered so `close` removes it. */
    async createRunWorkItem(args) {
      const { item } = await rpc('workItems.create', args);
      createdIds.push(item.id);
      return item;
    },
    /** Removes the run's work items (app, then cloud), then closes the app and deletes its profile. */
    async close() {
      const failures = [];
      for (const id of createdIds) {
        try {
          await rpc('workItems.remove', id);
          await deleteWorkItemFromCloud(instance.rpc, id);
        } catch (error) {
          failures.push(`${id}: ${error.message}`);
        }
      }
      await instance.close();
      for (const dir of scratchRepos) {
        removeScratchRepo(dir);
      }
      if (failures.length > 0) {
        throw new Error(`The run left work items behind:\n${failures.join('\n')}`);
      }
    },
  };
}
