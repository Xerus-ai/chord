/**
 * Phase 1 checks 9 and 7, on a repository whose committed `.chord.json` has a
 * setup script that logs each run to `marks/setup-ran.txt` and fails until
 * `marks/setup-ok` exists.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { listChats, replyText } from '../history/history-chat.mjs';
import { waitFor } from '../sharing/sharing-accounts.mjs';
import { answerTrustPrompt, isTrustPromptClosed } from '../trust-prompt.mjs';
import {
  createButton,
  listItemIds,
  nameField,
  openCreateDialog,
  waitForNewItem,
  waitForSetup,
} from './phase1-support.mjs';

/** The team config of the setup repository; `marks` is a forward-slash path. */
export function setupRepoConfig(marks) {
  const code =
    "const f=require('fs');" +
    `f.appendFileSync('${marks}/setup-ran.txt','ran\\n');` +
    `if(f.existsSync('${marks}/setup-ok')){console.log('setup ok')}` +
    "else{console.error('setup-ok flag missing');process.exit(1)}";
  return { scripts: { setup: `node -e "${code}"` } };
}

const setupRuns = (repo) => {
  const file = join(repo.marks, 'setup-ran.txt');
  return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean).length : 0;
};

/** The work item's agent turns as stored, across its chats. */
async function readAgentReplies(account, workItemId) {
  const replies = [];
  for (const chat of await listChats(account, workItemId)) {
    const { turns } = await account.call('chatMessages.getTimelineTurns', {
      workItemId,
      sessionId: chat.id,
    });
    for (const turn of turns) {
      if (turn.status === 'complete') replies.push(replyText(turn.items));
    }
  }
  return replies;
}

/** Check 9: a failing setup shows its log and Retry, and the first prompt waits for it. */
export async function checkFailingSetupHoldsFirstTurn(ctx, repo) {
  const { account, page, r } = ctx;
  const app = account.instance.app;
  const before = await listItemIds(account);
  const dialog = await openCreateDialog(page, repo.alias);
  await nameField(dialog).fill(`Phase 1 setup ${Date.now()}`);
  await dialog
    .getByPlaceholder('What should the agent do first?')
    .fill('Reply with only the word READY.');
  await waitFor(() => createButton(dialog).isEnabled(), 15_000, 'Create to be enabled');
  await createButton(dialog).click();
  await answerTrustPrompt(app, 'run', { timeoutMs: 60_000, shotPath: r.shot('trust-prompt') });
  const item = await waitForNewItem(account, before, 'the setup item');
  ctx.created.push(item.id);
  // Create opened the item.
  const lane = await waitForSetup(account, item.id, 'failed');
  const banner = page.getByText('Setup failed — agents wait until it succeeds', { exact: true });
  await banner.waitFor({ timeout: 30_000 });
  const log = page.getByText(/setup-ok flag missing/);
  await log.first().waitFor({ timeout: 30_000 });
  const retry = page.getByRole('button', { name: 'Retry', exact: true });
  // Long enough for an agent that was not held to have started and answered.
  await page.waitForTimeout(10_000);
  const repliesWhileFailed = await readAgentReplies(account, item.id);
  await page.screenshot({ path: r.shot('setup-failed') });
  r.check(
    'A failing setup shows its log and Retry',
    (await banner.isVisible()) && (await log.first().isVisible()) && (await retry.isVisible()),
    `setup ${lane.setupStatus}; log line shown; Retry shown`
  );
  // devstation-pan7: the header owns the window's top strip, where Windows
  // paints its caption buttons; the setup banner sits below it.
  const header = await page.getByTestId('work-item-header').boundingBox();
  const bannerBox = await banner.boundingBox();
  r.check(
    'The setup banner sits below the work item header, clear of the window controls',
    header !== null &&
      bannerBox !== null &&
      header.y === 0 &&
      bannerBox.y >= header.y + header.height,
    `header y ${header?.y} h ${header?.height}; banner y ${bannerBox?.y}`
  );
  r.check(
    "The agent's first turn waits while setup has failed",
    repliesWhileFailed.length === 0,
    `agent replies while failed: ${repliesWhileFailed.length}`
  );

  writeFileSync(join(repo.marks, 'setup-ok'), '');
  await retry.click();
  await waitForSetup(account, item.id, 'ok');
  let replies = [];
  await waitFor(
    async () => {
      replies = await readAgentReplies(account, item.id);
      return replies.length > 0;
    },
    5 * 60_000,
    'the held first prompt to be answered'
  );
  await page.getByText('READY').first().waitFor({ timeout: 30_000 });
  // The rail's row counts repoll every five seconds.
  await page
    .getByText('2 msgs', { exact: true })
    .first()
    .waitFor({ timeout: 15_000 })
    .catch(() => {});
  await page.screenshot({ path: r.shot('first-turn-after-retry') });
  r.check(
    'Once a Retry succeeds, the held first prompt reaches the agent',
    replies.some((reply) => /\bREADY\b/.test(reply)),
    `reply: ${replies.join(' | ').slice(0, 120)}`
  );
  // devstation-w50w: the held prompt belongs to the chat it reached.
  const [chat] = await listChats(account, item.id);
  const { summaries } = await account.call('agentSessions.getRowSummaries', item.id);
  const count = summaries.find((summary) => summary.sessionId === chat.id)?.messageCount;
  r.check(
    "The chat's row counts the held prompt and the reply",
    count === 2,
    `${count} msgs for "${chat.title}"`
  );
  return { item, lane };
}

/** Check 7: the agent edits `.chord.json` in the lane; the next setup still runs the trusted script. */
export async function checkEditedConfigRunsTrustedScript(ctx, repo, lane) {
  const { account, r } = ctx;
  const runsBefore = setupRuns(repo);
  const hacked = join(repo.marks, 'hacked.txt');
  const edited = {
    scripts: { setup: `node -e "require('fs').writeFileSync('${repo.marksArg}/hacked.txt','x')"` },
  };
  writeFileSync(join(lane.path, '.chord.json'), `${JSON.stringify(edited, null, 2)}\n`);
  const { status } = await account.call('worktrees.retrySetup', lane.id);
  const asked = !(await isTrustPromptClosed(account.instance.app));
  r.check(
    'After the agent edits .chord.json in a lane, the next setup still runs the trusted script',
    status === 'ok' && setupRuns(repo) === runsBefore + 1 && !existsSync(hacked) && !asked,
    `setup ${status}; trusted script runs ${runsBefore} → ${setupRuns(repo)}; ` +
      `edited script ran: ${existsSync(hacked)}; prompt opened: ${asked}`
  );
}
