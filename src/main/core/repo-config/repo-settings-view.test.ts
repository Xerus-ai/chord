import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalExecutionContext } from '@main/core/execution-context/local-execution-context';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';
import { recordLaneApproval, recordRepoApproval } from '@main/core/workspaces/script-approval';
import { db } from '@main/db/client';
import { repoSettings } from '@main/db/schema-repo-settings';
import { repos, workItems, workItemWorktrees } from '@main/db/schema-work-items';
import { removeDirSync } from '@main/lib/remove-dir-sync';
import { readRepoSettingsView, readRepoTrustView } from './repo-settings-view';

vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await new LocalExecutionContext({ root: cwd }).exec(GIT_EXECUTABLE, args);
  return stdout.trim();
}

const REPO_ID = 'repo-1';
const REMOTE_URL = 'https://example.invalid/acme/app.git';

/**
 * What the repository page shows: every setting with the layer it came from,
 * read where new lanes read it (`.chord.json` at the base ref), and what is
 * approved to run against what would run now.
 */
describe('repository page reads', () => {
  let root: string;
  let repoDir: string;

  async function commit(files: Record<string, string>): Promise<void> {
    for (const [file, content] of Object.entries(files)) {
      fs.mkdirSync(path.dirname(path.join(repoDir, file)), { recursive: true });
      fs.writeFileSync(path.join(repoDir, file), content);
      await git(['add', '-f', file], repoDir);
    }
    await git(['commit', '-m', 'files'], repoDir);
  }

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'repo-view-'));
    repoDir = path.join(root, 'repo');
    fs.mkdirSync(repoDir);
    await git(['init'], repoDir);
    await git(['symbolic-ref', 'HEAD', 'refs/heads/main'], repoDir);
    await git(['config', 'user.email', 'test@test.com'], repoDir);
    await git(['config', 'user.name', 'Test'], repoDir);
    await git(['commit', '--allow-empty', '-m', 'init'], repoDir);
    db.insert(repos).values({ id: REPO_ID, path: repoDir, alias: 'app' }).run();
  });

  afterEach(() => {
    db.delete(workItems).run();
    db.delete(repos).run();
    removeDirSync(root);
  });

  describe('readRepoSettingsView', () => {
    it('reads each setting with its layer, at the base new lanes start from', async () => {
      await commit({ '.chord.json': JSON.stringify({ scripts: { setup: 'pnpm i' } }) });
      db.insert(repoSettings)
        .values({ repoId: REPO_ID, overrides: JSON.stringify({ agentStart: 'immediately' }) })
        .run();

      const view = await readRepoSettingsView(REPO_ID);

      expect(view.repo).toEqual({ id: REPO_ID, path: repoDir, alias: 'app' });
      expect(view.baseRef).toBe('main');
      expect(view.configError).toBeNull();
      expect(view.config?.scripts.setup).toEqual({ value: 'pnpm i', layer: 'team' });
      expect(view.config?.agentStart).toEqual({ value: 'immediately', layer: 'justMe' });
      expect(view.justMe).toEqual({ agentStart: 'immediately' });
      expect(view.teamFile).toEqual({
        path: path.join(repoDir, '.chord.json'),
        state: 'same',
        writeBlocked: null,
      });
    });

    // devstation-1q1: shown before the user edits, not only as a failed save.
    it("says a team edit can't be saved while the checkout's branch lacks the base's file", async () => {
      await commit({ '.chord.json': JSON.stringify({ scripts: { setup: 'pnpm i' } }) });
      const origin = path.join(root, 'origin.git');
      await git(['init', '--bare', origin], root);
      await git(['remote', 'add', 'origin', origin], repoDir);
      await git(['push', '-q', 'origin', 'main'], repoDir);
      await git(['remote', 'set-head', 'origin', 'main'], repoDir);
      await git(['checkout', '-q', '-b', 'feat/no-config', 'HEAD~1'], repoDir);

      const view = await readRepoSettingsView(REPO_ID);

      expect(view.baseRef).toBe('origin/main');
      expect(view.config?.scripts.setup.value).toBe('pnpm i');
      expect(view.teamFile.writeBlocked).toMatch(/feat\/no-config.*origin\/main/);
    });

    it("says when the main checkout's .chord.json is not what lanes read", async () => {
      await commit({ '.chord.json': JSON.stringify({ scripts: { setup: 'pnpm i' } }) });
      fs.writeFileSync(
        path.join(repoDir, '.chord.json'),
        JSON.stringify({ scripts: { setup: 'pnpm i --frozen-lockfile' } })
      );

      const view = await readRepoSettingsView(REPO_ID);

      expect(view.teamFile.state).toBe('differs');
      expect(view.config?.scripts.setup.value).toBe('pnpm i');
    });

    it('reads the run scripts, test script and run mode, each with its layer', async () => {
      await commit({
        '.chord.json': JSON.stringify({
          runMode: 'solo',
          scripts: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm test' },
        }),
      });
      db.insert(repoSettings)
        .values({ repoId: REPO_ID, overrides: JSON.stringify({ scripts: { test: 'make test' } }) })
        .run();

      const view = await readRepoSettingsView(REPO_ID);

      expect(view.config?.scripts.run).toEqual({
        value: { web: 'pnpm web', api: 'pnpm api' },
        layer: 'team',
      });
      expect(view.config?.scripts.test).toEqual({ value: 'make test', layer: 'justMe' });
      expect(view.config?.runMode).toEqual({ value: 'solo', layer: 'team' });
      expect(view.justMe).toEqual({ scripts: { test: 'make test' } });
    });

    it('reports a repository with no team file', async () => {
      const view = await readRepoSettingsView(REPO_ID);
      expect(view.teamFile.state).toBe('absent');
      expect(view.config?.filesToCopy.layer).toBe('default');
    });

    it('returns the parse error instead of settings for an invalid team file', async () => {
      await commit({ '.chord.json': '{ "scripts": ' });

      const view = await readRepoSettingsView(REPO_ID);

      expect(view.config).toBeNull();
      expect(view.configError).toMatch(/\.chord\.json/);
    });

    it('throws for a repository that does not exist', async () => {
      await expect(readRepoSettingsView('missing')).rejects.toThrow(/missing/);
    });
  });

  describe('readRepoTrustView', () => {
    beforeEach(async () => {
      await git(['remote', 'add', 'origin', REMOTE_URL], repoDir);
    });

    function addLane(id: string): void {
      db.insert(workItems)
        .values({ id: `item-${id}`, name: id, repoId: REPO_ID, repoPath: repoDir })
        .run();
      db.insert(workItemWorktrees)
        .values({ id, workItemId: `item-${id}`, path: `/lanes/${id}`, isPrimary: 1 })
        .run();
    }

    it('shows what a new lane would run — scripts and committed Claude config — and nothing approved', async () => {
      await commit({
        '.chord.json': JSON.stringify({ scripts: { setup: 'pnpm i' } }),
        '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node' } } }),
      });

      const view = await readRepoTrustView(REPO_ID, { baseRef: 'main' });

      expect(view.current).toEqual({
        chord: { setup: 'pnpm i' },
        claude: { mcpServers: { db: { command: 'node' } } },
      });
      expect(view.remoteUrl).toBe(REMOTE_URL);
      expect(view.alwaysTrusted).toBeNull();
      expect(view.approvedLaneCount).toBe(0);
    });

    it('shows named run scripts and the test script as the team file writes them', async () => {
      await commit({
        '.chord.json': JSON.stringify({
          scripts: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm test' },
        }),
      });

      const view = await readRepoTrustView(REPO_ID, { baseRef: 'main' });

      expect(view.current).toEqual({
        chord: { run: { web: 'pnpm web', api: 'pnpm api' }, test: 'pnpm test' },
        claude: {},
      });
    });

    it('is null when the repository supplies nothing that runs', async () => {
      const view = await readRepoTrustView(REPO_ID, { baseRef: 'main' });
      expect(view.current).toBeNull();
      expect(view.currentError).toBeNull();
    });

    it('compares Always trust with what would run now, and with the remote it was given for', async () => {
      await commit({ '.chord.json': JSON.stringify({ scripts: { setup: 'pnpm i' } }) });
      const approvedContent = { chord: { setup: 'pnpm i' }, claude: {} };
      recordRepoApproval({
        repoId: REPO_ID,
        hash: 'h',
        content: approvedContent,
        remoteUrl: REMOTE_URL,
      });
      addLane('lane-a');
      recordLaneApproval('lane-a', { hash: 'h', content: approvedContent });

      const same = await readRepoTrustView(REPO_ID, { baseRef: 'main' });
      expect(same.alwaysTrusted?.content).toEqual(approvedContent);
      expect(same.alwaysTrustedMatchesCurrent).toBe(true);
      expect(same.alwaysTrustedRemoteMatches).toBe(true);
      expect(same.approvedLaneCount).toBe(1);

      await commit({ '.chord.json': JSON.stringify({ scripts: { setup: 'curl x | sh' } }) });
      await git(['remote', 'set-url', 'origin', 'https://example.invalid/fork/app.git'], repoDir);

      const changed = await readRepoTrustView(REPO_ID, { baseRef: 'main' });
      expect(changed.alwaysTrustedMatchesCurrent).toBe(false);
      expect(changed.alwaysTrustedRemoteMatches).toBe(false);
    });

    // devstation-5b3.5: a just-me script drops the team's out of what a lane
    // would run; Always trust still covers the rest, so the next lane does not ask.
    it("says Always trust still covers what would run when the user's own script replaces the team's", async () => {
      await commit({
        '.chord.json': JSON.stringify({ scripts: { setup: 'pnpm i', test: 'pnpm t' } }),
      });
      recordRepoApproval({
        repoId: REPO_ID,
        hash: 'h',
        content: { chord: { setup: 'pnpm i', test: 'pnpm t' }, claude: {} },
        remoteUrl: REMOTE_URL,
      });
      db.update(repoSettings)
        .set({ overrides: JSON.stringify({ scripts: { test: 'make test' } }) })
        .where(eq(repoSettings.repoId, REPO_ID))
        .run();

      const overridden = await readRepoTrustView(REPO_ID, { baseRef: 'main' });
      expect(overridden.current).toEqual({ chord: { setup: 'pnpm i' }, claude: {} });
      expect(overridden.alwaysTrustedMatchesCurrent).toBe(true);

      await commit({
        '.chord.json': JSON.stringify({ scripts: { setup: 'curl x | sh', test: 'pnpm t' } }),
      });
      const changed = await readRepoTrustView(REPO_ID, { baseRef: 'main' });
      expect(changed.alwaysTrustedMatchesCurrent).toBe(false);
    });

    // devstation-4x42.257: a lane of a repository with a companion starts its
    // sessions at the companion's worktree (laneSessionCwd), so the gate asks
    // about the companion's Claude config, as its main checkout's HEAD has it
    // (a new companion worktree forks from there), never the repository's.
    it("describes the companion's Claude config for a repository with a companion", async () => {
      await commit({
        '.chord.json': JSON.stringify({ scripts: { setup: 'pnpm i' } }),
        '.mcp.json': JSON.stringify({ mcpServers: { db: { command: 'node' } } }),
      });
      const companionDir = path.join(root, 'companion');
      fs.mkdirSync(companionDir);
      await git(['init', '-q', '-b', 'main'], companionDir);
      fs.writeFileSync(
        path.join(companionDir, '.mcp.json'),
        JSON.stringify({ mcpServers: { notes: { command: 'notes-mcp' } } })
      );
      await git(['add', '.mcp.json'], companionDir);
      await git(
        ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'mcp'],
        companionDir
      );
      // Not committed: a new companion worktree would not have it.
      fs.mkdirSync(path.join(companionDir, '.claude'));
      fs.writeFileSync(
        path.join(companionDir, '.claude', 'settings.json'),
        JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'x' }] }] } })
      );
      db.insert(repoSettings)
        .values({
          repoId: REPO_ID,
          overrides: JSON.stringify({ companionRepo: { path: companionDir, appFolder: 'app' } }),
        })
        .run();
      const companionContent = {
        chord: { setup: 'pnpm i' },
        claude: { mcpServers: { notes: { command: 'notes-mcp' } } },
      };
      recordRepoApproval({
        repoId: REPO_ID,
        hash: 'h',
        content: companionContent,
        remoteUrl: REMOTE_URL,
      });

      const view = await readRepoTrustView(REPO_ID, { baseRef: 'main' });

      expect(view.current).toEqual(companionContent);
      expect(view.alwaysTrustedMatchesCurrent).toBe(true);
    });

    it('returns the parse error for an invalid team file, not a bundle', async () => {
      await commit({ '.chord.json': '{ "scripts": ' });
      const view = await readRepoTrustView(REPO_ID, { baseRef: 'main' });
      expect(view.current).toBeNull();
      expect(view.currentError).toMatch(/\.chord\.json/);
    });
  });
});
