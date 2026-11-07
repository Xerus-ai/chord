/* global window -- page.evaluate callbacks run inside the app window */
/**
 * What the history suites (plan §Phase 5, devstation-b4p.4) share: a scratch
 * repository, a work item in it, real agent turns sent to a chat, and the
 * chat's turns as the UI shows them.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { waitFor } from '../sharing/sharing-accounts.mjs';

const TURN_TIMEOUT_MS = 5 * 60_000;

export const git = (cwd, ...args) =>
  execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

/** origin (bare) with main = [README.md]; the root is a clone of it. No .chord.json, so no trust prompt. */
export function createScratchRepo(prefix) {
  const scratch = mkdtempSync(join(tmpdir(), prefix));
  const origin = join(scratch, 'origin.git');
  const author = join(scratch, 'author');
  const root = join(scratch, 'root');
  git(scratch, 'init', '-q', '--bare', '-b', 'main', origin);
  git(scratch, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# history e2e\n');
  git(author, 'add', '.');
  git(author, 'commit', '-q', '-m', 'readme');
  git(author, 'push', '-q', 'origin', 'main');
  git(scratch, 'clone', '-q', origin, root);
  git(root, 'config', 'user.email', 'e2e@chord.invalid');
  git(root, 'config', 'user.name', 'Chord e2e');
  return { scratch, root };
}

/** A work item in the repository, once its lane is checked out; with its primary lane. */
export async function createWorkItem(account, repoId, name) {
  const created = await account.call('workItems.create', { name, repoId });
  let workItem = created.item;
  await waitFor(
    async () => {
      const { items } = await account.call('workItems.getAll');
      workItem = items.find((w) => w.id === workItem.id);
      return workItem?.provisionStatus === 'ready';
    },
    120_000,
    `${name} to be checked out`
  );
  const { worktrees } = await account.call('worktrees.list', workItem.id);
  return { workItem, primary: worktrees.find((w) => w.isPrimary) };
}

/** A file's text with line endings and the trailing newline dropped; null when absent. */
export function readText(path) {
  if (!existsSync(path)) return null;
  return readFileSync(path, 'utf8').replace(/\r\n/g, '\n').trim();
}

/** A turn's reply text, tools and thinking left out. */
export function replyText(items) {
  return items
    .filter((item) => item.kind === 'text')
    .map((item) => item.text)
    .join(' ');
}

/**
 * Sends one prompt to the chat and waits for its turn, answering permission
 * cards with allow-once. Returns the finished turn's items.
 */
export async function runTurn(account, { workItemId, sessionId, providerId }, content) {
  const before = await account.call('chatMessages.getTimelineTurns', { workItemId, sessionId });
  const known = new Set(before.turns.map((turn) => turn.turnId));
  await account.call('chatMessages.sendToAgent', {
    workItemId,
    sessionId,
    content,
    agentProviderId: providerId,
  });
  const answered = new Set();
  const deadline = Date.now() + TURN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { turns } = await account.call('chatMessages.getTimelineTurns', {
      workItemId,
      sessionId,
    });
    for (const item of turns.flatMap((turn) => turn.items)) {
      if (item.kind !== 'permission' || item.resolved || answered.has(item.requestId)) continue;
      answered.add(item.requestId);
      const allowOnce = item.options.find((option) => option.kind === 'allow_once');
      if (!allowOnce) throw new Error(`No allow-once option: ${JSON.stringify(item.options)}`);
      await account.call('acp.respondToPermission', {
        workItemId,
        requestId: item.requestId,
        optionId: allowOnce.optionId,
      });
    }
    const fresh = turns.filter((turn) => !known.has(turn.turnId));
    if (fresh.length > 0 && fresh.every((turn) => turn.status === 'complete')) {
      return fresh.flatMap((turn) => turn.items);
    }
    await account.instance.page.waitForTimeout(1000);
  }
  throw new Error(`Turn did not complete within ${TURN_TIMEOUT_MS / 1000}s: ${content}`);
}

/** Opens the work item, then the chat's tab, as a click on its tab would. */
export async function openChat(page, workItemName, sessionId) {
  await page.getByText(workItemName, { exact: true }).first().click();
  await switchToChat(page, sessionId);
}

export async function switchToChat(page, sessionId) {
  await page.evaluate((id) => {
    window.dispatchEvent(
      new CustomEvent('chord:switch-tab', { detail: { kind: 'session', sessionId: id } })
    );
  }, sessionId);
  // Other chats' transcripts stay mounted, hidden: wait for the one shown.
  await page
    .locator('[data-testid="chat-transcript"]')
    .filter({ visible: true })
    .first()
    .waitFor({ timeout: 30_000 });
}

/** The `index`th agent turn shown in the open chat (0 = the first). */
export function turnBox(page, index) {
  return page.locator('[data-testid="chat-transcript"] .group\\/turn').nth(index);
}

/** The chat sessions of the work item, oldest first. */
export async function listChats(account, workItemId) {
  const { sessions } = await account.call('agentSessions.getAll', workItemId);
  return sessions.filter((session) => session.kind === 'chat');
}

/** Waits for a chat the work item did not have, and returns it. */
export async function waitForNewChat(account, workItemId, knownIds, what) {
  let chat = null;
  await waitFor(
    async () => {
      chat = (await listChats(account, workItemId)).find((s) => !knownIds.includes(s.id)) ?? null;
      return chat !== null;
    },
    120_000,
    what
  );
  return chat;
}

/** `git status --porcelain` as trimmed lines, sorted. */
export function statusLines(cwd) {
  return git(cwd, 'status', '--porcelain')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}
