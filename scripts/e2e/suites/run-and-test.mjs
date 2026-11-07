/**
 * Live check for plan §Phase 4 slice 2 (devstation-5b3.2), driven through the
 * real UI: the Run tab starts, stops and tests a lane's processes.
 *
 *   1. The scratch repository's team `.chord.json` names two run scripts —
 *      `web`, a node server on CHORD_PORT that prints its URL and notes Ctrl+C,
 *      and `worker`, a node loop — a test script that exits 0, and a teardown
 *      that writes a marker outside the checkout. No setup script, so creating
 *      the work item asks nothing.
 *   2. The Run tab lists both scripts (never run), Test, the setup state and
 *      the lane's port block.
 *   3. Start web → the "Run scripts?" window → Run scripts; the row shows the
 *      URL, which serves. Start worker asks nothing more. Stop web stops it
 *      with Ctrl+C (its handler's marker exists, its process is gone).
 *   4. Run tests → Passed. A just-me test script that exits 1 → Failed (exit 1),
 *      and the tab's dot turns red.
 *   5. Repo › Run & test shows the named run scripts, Test and Run mode.
 *   6. Deleting the work item, from the work list, stops every run (no node
 *      process of the lane is left) and runs the team's teardown without a
 *      "Run scripts?" window: the lane's approval still covers it after the
 *      just-me test replaced the team's (devstation-5b3.5). The item leaves
 *      the sidebar.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-run node scripts/e2e/suites/run-and-test.mjs
 *
 * Uses a scratch repository (a bare origin plus a clone) under the OS temp
 * folder. Its work item is deleted in the app, and the suite waits until the
 * cloud no longer has it. Screenshots: screenshots/e2e/run-and-test-*.png.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { openRunTerminal } from '../lib/run-terminal-check.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';
import { answerTrustPrompt, findTrustPrompt, isTrustPromptClosed } from '../lib/trust-prompt.mjs';

const SEED_PROFILE = process.env.CHORD_E2E_PROFILE ?? 'chord-p1-smoke';
const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `run-and-test-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
// eslint-disable-next-line no-control-regex
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '');

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

const WEB_SCRIPT = `const fs = require('node:fs');
const path = require('node:path');
const marks = process.argv[2];
const port = Number(process.env.CHORD_PORT);
const server = require('node:http').createServer((req, res) => res.end('chord run e2e'));
server.listen(port, '127.0.0.1', () => {
  fs.writeFileSync(path.join(marks, 'web.pid'), String(process.pid));
  console.log('web listening on http://localhost:' + port);
});
process.on('SIGINT', () => {
  fs.writeFileSync(path.join(marks, 'web-graceful.txt'), 'stopped on Ctrl+C');
  server.close();
  process.exit(0);
});
`;

const WORKER_SCRIPT = `const fs = require('node:fs');
fs.writeFileSync(require('node:path').join(process.argv[2], 'worker.pid'), String(process.pid));
setInterval(() => console.log('worker tick'), 1000);
`;

/** origin (bare) with main = [readme, scripts, .chord.json]; the repo is a clone of it. */
function createScratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'chord-run-and-test-'));
  const marks = join(root, 'marks');
  mkdirSync(marks);
  const marksArg = marks.replace(/\\/g, '/');
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'run-and-test');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  mkdirSync(join(author, 'scripts'));
  writeFileSync(join(author, 'README.md'), '# run and test\n');
  writeFileSync(join(author, 'scripts', 'web.cjs'), WEB_SCRIPT);
  writeFileSync(join(author, 'scripts', 'worker.cjs'), WORKER_SCRIPT);
  writeFileSync(join(author, 'scripts', 'test.cjs'), "console.log('tests ok');\n");
  const config = {
    scripts: {
      run: {
        web: `node scripts/web.cjs "${marksArg}"`,
        worker: `node scripts/worker.cjs "${marksArg}"`,
      },
      test: 'node scripts/test.cjs',
      teardown: `node -e "require('fs').writeFileSync('${marksArg}/teardown-ran.txt', process.env.CHORD_LANE_ID)"`,
    },
  };
  writeFileSync(join(author, '.chord.json'), `${JSON.stringify(config, null, 2)}\n`);
  git(author, 'add', '.');
  git(author, 'commit', '-q', '-m', 'scripts and team config');
  git(author, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  return { root, repo, marks };
}

const readMark = (scratch, name) => {
  const file = join(scratch.marks, name);
  return existsSync(file) ? readFileSync(file, 'utf8') : null;
};

async function readRuns(account, laneId) {
  return account.call('laneRuns.get', laneId);
}

async function waitForRuns(account, laneId, predicate, what, timeoutMs = 30_000) {
  let view = null;
  await waitFor(
    async () => {
      view = await readRuns(account, laneId);
      return predicate(view);
    },
    timeoutMs,
    what
  );
  return view;
}

async function checkRunTab(account, page, laneId) {
  await page.getByRole('tab', { name: 'Run', exact: true }).click();
  const web = page.getByRole('group', { name: 'web', exact: true });
  await web.waitFor({ timeout: 20_000 });
  const view = await readRuns(account, laneId);
  const ports = `Ports ${view.ports.base}–${view.ports.base + view.ports.size - 1} · CHORD_PORT=${view.ports.base}`;
  await page.screenshot({ path: shot('run-tab') });
  verdict(
    'the Run tab lists the configured scripts before any ran',
    JSON.stringify(view.scripts.map((s) => s.id)) === '["web","worker"]' &&
      (await page.getByRole('group', { name: 'worker', exact: true }).isVisible()) &&
      (await web.innerText()).includes('Stopped'),
    `rpc: ${view.scripts.map((s) => s.title).join(', ')}`
  );
  verdict(
    'the Run tab shows Test, setup and the port block',
    (await page.getByRole('group', { name: 'Test' }).isVisible()) &&
      (await page.getByText(ports, { exact: true }).isVisible()) &&
      view.setupStatus === 'ok',
    `${ports}; setup ${view.setupStatus}`
  );
  return view;
}

async function checkStartAndStop(account, page, app, laneId, ports, scratch) {
  const web = page.getByRole('group', { name: 'web', exact: true });
  await web.getByRole('button', { name: 'Start' }).click();
  const promptText = await answerTrustPrompt(app, 'run', {
    timeoutMs: 60_000,
    shotPath: shot('trust-prompt'),
  });
  verdict(
    'Start asks about the team script first',
    /web\.cjs/.test(promptText) && /worker\.cjs/.test(promptText),
    'the prompt listed the named run scripts'
  );
  const url = `http://localhost:${ports.base}`;
  await waitForRuns(
    account,
    laneId,
    (v) => v.runs.scripts.web?.url === url,
    'web to print its URL'
  );
  const urlButton = web.getByRole('button', { name: url });
  await urlButton.waitFor({ timeout: 10_000 });
  const served = await (await fetch(url)).text();
  await page.screenshot({ path: shot('web-running') });
  verdict(
    'web runs on the lane port and its URL is shown and serves',
    served === 'chord run e2e' && (await web.innerText()).includes(`Running · ${url}`),
    `${url} → ${served}`
  );

  const webRun = (await readRuns(account, laneId)).runs.scripts.web;
  const webTerminal = await openRunTerminal({
    account,
    group: web,
    ptySessionId: webRun.ptySessionId,
  });
  await page.screenshot({ path: shot('web-terminal') });
  verdict(
    "Show terminal opens web's live output",
    webTerminal.connected && webTerminal.output.includes(`web listening on ${url}`),
    webTerminal.output.trim().slice(-120)
  );

  await page
    .getByRole('group', { name: 'worker', exact: true })
    .getByRole('button', { name: 'Start' })
    .click();
  await waitForRuns(account, laneId, (v) => v.runs.scripts.worker?.status === 'running', 'worker');
  await waitFor(async () => readMark(scratch, 'worker.pid') !== null, 15_000, 'worker pid');
  verdict(
    'Start worker runs without asking again',
    await isTrustPromptClosed(app),
    'no Run scripts? window'
  );

  const webPid = Number(readMark(scratch, 'web.pid'));
  await web.getByRole('button', { name: 'Stop' }).click();
  const after = await waitForRuns(
    account,
    laneId,
    (v) => v.runs.scripts.web?.status === 'stopped',
    'web to stop'
  );
  await web.getByText('Stopped').waitFor({ timeout: 10_000 });
  // devstation-0eth: the open terminal says so too, not only the row.
  const lastTerminalLine = async () => {
    const { buffer } = await account.call('pty.subscribe', after.runs.scripts.web.ptySessionId);
    const lines = stripAnsi(buffer)
      .split(/\r?\n/)
      .filter((line) => line.trim() !== '');
    return lines[lines.length - 1] ?? '';
  };
  await waitFor(async () => (await lastTerminalLine()) === '[Stopped]', 10_000, 'the end line');
  await page.screenshot({ path: shot('web-stopped') });
  verdict(
    'Stop ends web gracefully with Ctrl+C',
    readMark(scratch, 'web-graceful.txt') === 'stopped on Ctrl+C' && !isAlive(webPid),
    `web ${after.runs.scripts.web.status}, pid ${webPid} gone`
  );
  verdict(
    "web's terminal ends with [Stopped], as its row says",
    (await lastTerminalLine()) === '[Stopped]',
    `last line "${await lastTerminalLine()}"`
  );
}

async function runTests(account, page, laneId, expected) {
  const testGroup = page.getByRole('group', { name: 'Test' });
  await testGroup.getByRole('button', { name: 'Run tests' }).click();
  const view = await waitForRuns(
    account,
    laneId,
    (v) => v.runs.test.status === expected,
    `tests to finish ${expected}`
  );
  return { view, testGroup };
}

async function checkTests(account, page, laneId, repoId) {
  const passed = await runTests(account, page, laneId, 'passed');
  await passed.testGroup.getByText('Passed', { exact: true }).waitFor({ timeout: 10_000 });
  const { buffer } = await account.call('pty.subscribe', passed.view.runs.test.ptySessionId);
  await page.screenshot({ path: shot('tests-passed') });
  verdict(
    'Run tests reports Passed from exit 0, with the log',
    passed.view.runs.test.exitCode === 0 && stripAnsi(buffer).includes('tests ok'),
    `exit ${passed.view.runs.test.exitCode} in ${passed.view.runs.test.durationMs} ms`
  );
  const testTerminal = await openRunTerminal({
    account,
    group: passed.testGroup,
    ptySessionId: passed.view.runs.test.ptySessionId,
  });
  await page.screenshot({ path: shot('tests-terminal') });
  verdict(
    'Show terminal opens the finished test run’s log',
    testTerminal.connected && testTerminal.output.includes('tests ok'),
    testTerminal.output.trim().slice(-120)
  );
  await passed.testGroup.getByRole('button', { name: 'Hide terminal' }).click();

  await account.call('repoSettings.updateJustMe', {
    repoId,
    patch: { scripts: { test: 'node -e "process.exit(1)"' } },
  });
  const failed = await runTests(account, page, laneId, 'failed');
  await failed.testGroup.getByText('Failed (exit 1)', { exact: true }).waitFor({ timeout: 10_000 });
  const tab = page.getByRole('tab', { name: 'Run', exact: true });
  await page.screenshot({ path: shot('tests-failed') });
  verdict(
    "a just-me test that exits 1 reports Failed (exit 1) and reddens the tab's dot",
    failed.view.runs.test.exitCode === 1 && (await tab.locator('.bg-status-err').count()) === 1,
    `exit ${failed.view.runs.test.exitCode}`
  );
}

async function checkRepoPage(page, alias) {
  await page.getByText(alias, { exact: true }).first().hover();
  await page.getByRole('button', { name: `${alias} options` }).click();
  await page.getByRole('menuitem', { name: 'Repository settings' }).click();
  const section = page.getByRole('region', { name: 'Run & test' });
  await section.waitFor({ timeout: 20_000 });
  await section.scrollIntoViewIfNeeded();
  const text = await section.innerText();
  await page.screenshot({ path: shot('repo-run-and-test') });
  verdict(
    'Repo › Run & test shows the named run scripts, Test and Run mode',
    /web/.test(text) && /worker/.test(text) && /Test/.test(text) && /Run mode/.test(text),
    'named scripts, Test and Run mode visible'
  );
}

async function checkDelete(account, page, app, workItem, laneId, scratch) {
  const pids = ['web.pid', 'worker.pid'].map((f) => Number(readMark(scratch, f)));
  await page.getByRole('button', { name: 'Dashboard' }).click();

  // Delete waits on any "Run scripts?" window it opens, so look for one
  // while it runs rather than after.
  let settled = false;
  const removal = account.call('workItems.remove', workItem.id).then(
    () => {
      settled = true;
      return { error: null };
    },
    (error) => {
      settled = true;
      return { error };
    }
  );
  let prompt = null;
  while (!settled && !prompt) prompt = await findTrustPrompt(app, 250);
  if (prompt) {
    await prompt.screenshot({ path: shot('delete-trust-prompt') });
    // Answered so the delete can finish; the run already failed.
    await answerTrustPrompt(app, 'decline');
  }
  verdict(
    "deleting the lane asks nothing: its approval covers the team's teardown beside the just-me test",
    prompt === null,
    prompt === null ? 'no Run scripts? window' : 'a Run scripts? window opened during the delete'
  );
  const { error } = await removal;
  if (error) throw error;

  const row = page.locator('[data-sidebar-row]').filter({ hasText: workItem.name });
  await waitFor(async () => (await row.count()) === 0, 30_000, 'the item to leave the sidebar');
  const gone = await account.instance.rpc('laneRuns.get', laneId);
  await page.screenshot({ path: shot('after-delete') });
  verdict(
    'deleting the work item stops every run of the lane',
    pids.every((pid) => !isAlive(pid)) && gone?.success === false,
    `pids ${pids.join(', ')} gone; laneRuns.get → ${gone?.error?.type}`
  );
  verdict(
    'and runs its teardown',
    readMark(scratch, 'teardown-ran.txt') === laneId,
    `teardown marker: ${readMark(scratch, 'teardown-ran.txt')}`
  );
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratchRepo();
  const account = await launchAccount({ seedProfile: SEED_PROFILE, label: 'run-and-test' });
  const { page, app } = account.instance;
  let workItem = null;
  let deleted = false;
  try {
    const alias = 'run-and-test';
    const { repo } = await account.call('repos.create', { path: scratch.repo, alias });
    const created = await account.call('workItems.create', {
      name: `Chord e2e run and test ${Date.now()}`,
      repoId: repo.id,
    });
    workItem = created.item;
    await waitFor(
      async () => {
        const { items } = await account.call('workItems.getAll');
        workItem = items.find((w) => w.id === workItem.id);
        return workItem?.provisionStatus === 'ready';
      },
      120_000,
      'the work item to be checked out'
    );
    verdict('creating the work item asked nothing', await isTrustPromptClosed(app), 'no setup');
    const { worktrees } = await account.call('worktrees.list', workItem.id);
    const laneId = worktrees.find((w) => w.isPrimary).id;

    const typed = await account.instance.rpc('laneRuns.start', { laneId, scriptId: 'nope' });
    verdict(
      'an unknown script is refused with a typed error',
      typed?.success === false && typed.error.type === 'no_script',
      JSON.stringify(typed?.error)
    );

    await page.getByText(workItem.name, { exact: true }).first().click();
    const view = await checkRunTab(account, page, laneId);
    await checkStartAndStop(account, page, app, laneId, view.ports, scratch);
    await checkTests(account, page, laneId, repo.id);
    await checkRepoPage(page, alias);
    await checkDelete(account, page, app, workItem, laneId, scratch);
    deleted = true;
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    if (workItem) {
      if (!deleted) await account.call('workItems.remove', workItem.id);
      await waitFor(
        async () => (await account.api('GET', `/work-items/${workItem.id}`)).status === 404,
        60_000,
        'the cloud to drop the run’s work item'
      );
    }
    await account.close();
    rmSync(scratch.root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
