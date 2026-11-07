/**
 * Live check for plan §Phase 4 slice 4 (devstation-5b3.4), driven through the
 * real UI: Solo runs one Docker Compose stack from the repository's root
 * checkout, for one lane at a time.
 *
 *   1. The scratch repository's `main` has a team `.chord.json` in Solo run
 *      mode whose run script is `docker compose up --remove-orphans`, and a
 *      `compose.yaml` with one service (`cache`, redis:7-alpine) on a fixed
 *      port. Two work items: A leaves it as it is; B commits a second service
 *      (`extra`, redis:latest) and edits `cache`'s env without committing.
 *   2. Solo A → the stack is up (`docker ps` by the compose project label)
 *      and the repo header reads "Soloing <A's work item>", A's branch on hover.
 *   3. Solo B → queued behind A ("Leave queue" is offered).
 *   4. Release A → B starts in the same directory: the same compose project,
 *      B's extra service up, every container of the project is one of B's
 *      services (one stack, not two), `cache` runs B's edited env, and the
 *      root's HEAD is B's; the repo header now names B's work item.
 *   5. Release B → the root is byte-identical to before Solo A (every
 *      non-ignored file, HEAD and branch), and nothing of the project runs:
 *      Release stops the attached `compose up` with Ctrl+C, which stops its
 *      containers.
 *   6. A file left in the root → Solo is refused, the file listed.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-solo node scripts/e2e/suites/solo-docker.mjs
 *
 * Needs Docker: without it the suite prints a FAIL line naming it and exits 1.
 * Uses a scratch repository (a bare origin plus a clone) under the OS temp
 * folder. Cleanup brings the compose project down (volumes included), deletes
 * the work items in the app and waits until the cloud no longer has them.
 * Screenshots: screenshots/e2e/solo-docker-*.png.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { openRunTerminal } from '../lib/run-terminal-check.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';
import { answerTrustPrompt } from '../lib/trust-prompt.mjs';

const SEED_PROFILE = process.env.CHORD_E2E_PROFILE ?? 'chord-p1-smoke';
const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `solo-docker-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

/** The root checkout's folder name, which is the compose project's name. */
const PROJECT = 'chord-solo-e2e';
const CACHE_PORT = 6391;

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
const docker = (...args) => execFileSync('docker', args, { stdio: 'pipe' }).toString().trim();

function dockerVersion() {
  try {
    return docker('info', '--format', '{{.ServerVersion}}');
  } catch (error) {
    return { error: String(error.stderr ?? error.message).trim() };
  }
}

/** The project's containers: running only, or all of them (`all`). */
function projectContainers({ all = false } = {}) {
  const out = docker(
    'ps',
    ...(all ? ['-a'] : []),
    '--filter',
    `label=com.docker.compose.project=${PROJECT}`,
    '--format',
    '{{.ID}} {{.Label "com.docker.compose.service"}}'
  );
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [id, service] = line.split(' ');
      return { id, service };
    });
}

function containerEnv(id) {
  return docker('inspect', '--format', '{{range .Config.Env}}{{println .}}{{end}}', id)
    .split('\n')
    .filter(Boolean);
}

function bringProjectDown(cwd) {
  execFileSync('docker', ['compose', '-p', PROJECT, 'down', '-v', '--remove-orphans'], {
    cwd,
    stdio: 'pipe',
  });
}

const COMPOSE_A = `services:
  cache:
    image: redis:7-alpine
    pull_policy: missing
    ports:
      - "${CACHE_PORT}:6379"
    environment:
      CHORD_E2E_MARK: "a"
`;

const EXTRA_SERVICE = `  extra:
    image: redis:latest
    pull_policy: missing
`;

/** origin (bare) with main = [readme, compose.yaml, .chord.json]; the root is a clone of it. */
function createScratchRepo() {
  const scratch = mkdtempSync(join(tmpdir(), 'chord-solo-docker-'));
  const origin = join(scratch, 'origin.git');
  const author = join(scratch, 'author');
  const root = join(scratch, PROJECT);
  git(scratch, 'init', '-q', '--bare', '-b', 'main', origin);
  git(scratch, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# solo docker\n');
  writeFileSync(join(author, 'compose.yaml'), COMPOSE_A);
  const config = {
    runMode: 'solo',
    scripts: { run: { stack: 'docker compose up --remove-orphans' } },
  };
  writeFileSync(join(author, '.chord.json'), `${JSON.stringify(config, null, 2)}\n`);
  git(author, 'add', '.');
  git(author, 'commit', '-q', '-m', 'compose stack in Solo mode');
  git(author, 'push', '-q', 'origin', 'main');
  git(scratch, 'clone', '-q', origin, root);
  git(root, 'config', 'user.email', 'e2e@chord.invalid');
  git(root, 'config', 'user.name', 'Chord e2e');
  return { scratch, root };
}

/** B's lane: a committed second service, then an uncommitted env edit. */
function prepareLaneB(lanePath) {
  git(lanePath, 'config', 'user.email', 'e2e@chord.invalid');
  git(lanePath, 'config', 'user.name', 'Chord e2e');
  writeFileSync(join(lanePath, 'compose.yaml'), `${COMPOSE_A}${EXTRA_SERVICE}`);
  git(lanePath, 'add', 'compose.yaml');
  git(lanePath, 'commit', '-q', '-m', 'add the extra service');
  const edited = readFileSync(join(lanePath, 'compose.yaml'), 'utf8').replace(
    'CHORD_E2E_MARK: "a"',
    'CHORD_E2E_MARK: "b"'
  );
  writeFileSync(join(lanePath, 'compose.yaml'), edited);
}

/** Every non-ignored file's sha256, plus HEAD and branch: what "byte-identical" means here. */
function fingerprintRoot(root) {
  const files = git(
    root,
    '-c',
    'core.quotepath=false',
    'ls-files',
    '-co',
    '--exclude-standard',
    '-z'
  )
    .split('\0')
    .filter(Boolean)
    .sort();
  const hashes = files.map(
    (file) =>
      `${file} ${createHash('sha256')
        .update(readFileSync(join(root, file)))
        .digest('hex')}`
  );
  return {
    head: git(root, 'rev-parse', 'HEAD'),
    branch: git(root, 'rev-parse', '--abbrev-ref', 'HEAD'),
    files: hashes.join('\n'),
  };
}

async function createWorkItem(account, repoId, name) {
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
  const lane = worktrees.find((w) => w.isPrimary);
  return { workItem, laneId: lane.id, branch: lane.branchName, path: lane.path };
}

async function openRunTab(page, item) {
  await page.getByText(item.workItem.name, { exact: true }).first().click();
  await page.getByRole('tab', { name: 'Run', exact: true }).click();
}

async function waitForSolo(account, repoId, predicate, what, timeoutMs = 60_000) {
  let state = null;
  await waitFor(
    async () => {
      state = await account.call('solo.getState', repoId);
      return predicate(state);
    },
    timeoutMs,
    what
  );
  return state;
}

async function checkSoloA(account, page, app, repoId, a) {
  await openRunTab(page, a);
  await page.getByRole('button', { name: 'Solo this branch' }).click();
  await answerTrustPrompt(app, 'run', { timeoutMs: 60_000, shotPath: shot('trust-prompt') });
  await waitForSolo(account, repoId, (s) => s.holder?.laneId === a.laneId, 'A to hold Solo');
  // A first run may pull the image.
  await waitFor(async () => projectContainers().length === 1, 300_000, "A's stack to be up");
  const header = page.getByText(`Soloing ${a.workItem.name}`, { exact: true });
  await header.waitFor({ timeout: 20_000 });
  // The name is a span inside the titled button: hovering it shows the
  // nearest ancestor's title, as a browser resolves the tooltip.
  const hover = await header.locator('xpath=ancestor-or-self::*[@title][1]').getAttribute('title');
  await page.screenshot({ path: shot('solo-a') });
  const running = projectContainers();
  verdict(
    "Solo A brings A's stack up from the root, and the repo header names A's work item",
    running.length === 1 && running[0].service === 'cache' && (await header.isVisible()),
    `${running.map((c) => c.service).join(', ')} in project ${PROJECT}`
  );
  verdict(
    "the repo header's hover names A's branch",
    hover === `Soloing ${a.workItem.name} on ${a.branch}`,
    `title: ${hover}`
  );

  // Compose's own output, from the root, in the stack row's terminal
  // (devstation-5b3.7).
  const stackRun = (await account.call('laneRuns.get', a.laneId)).runs.scripts.stack;
  const stackTerminal = await openRunTerminal({
    account,
    group: page.getByRole('group', { name: 'stack', exact: true }),
    ptySessionId: stackRun.ptySessionId,
  });
  await page.screenshot({ path: shot('stack-terminal') });
  verdict(
    "Show terminal opens Compose's output in Solo",
    stackTerminal.connected && /cache/i.test(stackTerminal.output),
    stackTerminal.output.trim().slice(-160)
  );
}

async function checkQueueB(account, page, app, repoId, b) {
  await openRunTab(page, b);
  await page.getByRole('button', { name: 'Queue (1 ahead)' }).click();
  await answerTrustPrompt(app, 'run', { timeoutMs: 60_000 });
  const state = await waitForSolo(
    account,
    repoId,
    (s) => s.queue.some((entry) => entry.laneId === b.laneId),
    'B to queue'
  );
  const leave = page.getByRole('button', { name: 'Leave queue' });
  await leave.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: shot('b-queued') });
  verdict(
    'Solo B on a taken slot queues it behind A',
    state.queue.length === 1 && (await leave.isVisible()),
    `queue: ${state.queue.map((entry) => entry.branch).join(', ')}`
  );
}

async function checkHandOver(account, page, repoId, a, b, root, firstCacheId) {
  await openRunTab(page, a);
  await page.getByRole('button', { name: 'Release' }).click();
  await waitForSolo(account, repoId, (s) => s.holder?.laneId === b.laneId, 'B to take the slot');
  await waitFor(
    async () => projectContainers().length === 2,
    300_000,
    "B's stack (cache + extra) to be up"
  );
  const running = projectContainers();
  const all = projectContainers({ all: true });
  const cache = running.find((c) => c.service === 'cache');
  const mark = cache ? containerEnv(cache.id).find((e) => e.startsWith('CHORD_E2E_MARK=')) : null;
  const laneHead = git(b.path, 'rev-parse', 'HEAD');
  const header = page.getByText(`Soloing ${b.workItem.name}`, { exact: true });
  await header.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: shot('handed-to-b') });
  verdict(
    "Release A hands the root to B: B's services in the same project, one stack",
    running
      .map((c) => c.service)
      .sort()
      .join(',') === 'cache,extra' && all.length === 2,
    `running ${running.map((c) => c.service).join(', ')}; ${all.length} containers in ${PROJECT}`
  );
  verdict(
    "B's uncommitted env edit runs, in a recreated cache container",
    mark === 'CHORD_E2E_MARK=b' && cache?.id !== firstCacheId,
    `${mark}; cache ${firstCacheId} → ${cache?.id}`
  );
  verdict(
    "the repo header names B's work item once B holds the root",
    await header.isVisible(),
    `${await header.textContent()}`
  );
  verdict(
    "the root's HEAD is B's",
    git(root, 'rev-parse', 'HEAD') === laneHead,
    `${git(root, 'rev-parse', 'HEAD')} vs lane ${laneHead}`
  );
}

async function checkReleaseB(account, page, repoId, b, root, before) {
  await openRunTab(page, b);
  await page.getByRole('button', { name: 'Release' }).click();
  await waitForSolo(account, repoId, (s) => s.holder === null, 'the slot to be free');
  await waitFor(async () => projectContainers().length === 0, 60_000, 'the stack to stop');
  const after = fingerprintRoot(root);
  await page.getByRole('button', { name: 'Solo this branch' }).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: shot('released') });
  verdict(
    'Release B returns the root byte for byte, on its branch',
    after.head === before.head && after.branch === before.branch && after.files === before.files,
    `${after.branch} @ ${after.head.slice(0, 8)}; files ${after.files === before.files ? 'identical' : 'DIFFER'}`
  );
  verdict(
    "and Ctrl+C stopped the attached compose's containers",
    projectContainers().length === 0,
    `${projectContainers().length} running in ${PROJECT}`
  );
}

async function checkDirtyRoot(account, page, repoId, a, root) {
  writeFileSync(join(root, 'dirty.txt'), 'left in the root\n');
  const head = git(root, 'rev-parse', 'HEAD');
  await openRunTab(page, a);
  await page.getByRole('button', { name: 'Solo this branch' }).click();
  const alert = page.getByRole('alert').filter({ hasText: 'Commit or stash these in' });
  await alert.waitFor({ timeout: 20_000 });
  const listed = await page.getByRole('listitem').filter({ hasText: 'dirty.txt' }).isVisible();
  const state = await account.call('solo.getState', repoId);
  await page.screenshot({ path: shot('dirty-root-refused') });
  verdict(
    'Solo on a dirty root is refused, listing the file',
    listed && state.holder === null && git(root, 'rev-parse', 'HEAD') === head,
    `${await alert.innerText()}`
  );
  rmSync(join(root, 'dirty.txt'));
}

async function main() {
  const version = dockerVersion();
  if (typeof version !== 'string') {
    verdict('Docker is available (docker info)', false, version.error);
    process.exitCode = 1;
    return;
  }
  console.log(`Docker ${version}`);
  await assertServerHealthy();
  const { scratch, root } = createScratchRepo();
  bringProjectDown(root);
  const account = await launchAccount({ seedProfile: SEED_PROFILE, label: 'solo-docker' });
  const { page, app } = account.instance;
  const items = [];
  let repoId = null;
  try {
    const { repo } = await account.call('repos.create', { path: root, alias: PROJECT });
    repoId = repo.id;
    const stamp = Date.now();
    const a = await createWorkItem(account, repo.id, `Chord e2e solo A ${stamp}`);
    items.push(a);
    const b = await createWorkItem(account, repo.id, `Chord e2e solo B ${stamp}`);
    items.push(b);
    prepareLaneB(b.path);
    const before = fingerprintRoot(root);

    await checkSoloA(account, page, app, repo.id, a);
    const firstCacheId = projectContainers()[0]?.id;
    await checkQueueB(account, page, app, repo.id, b);
    await checkHandOver(account, page, repo.id, a, b, root, firstCacheId);
    await checkReleaseB(account, page, repo.id, b, root, before);
    await checkDirtyRoot(account, page, repo.id, a, root);
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    rmSync(join(root, 'dirty.txt'), { force: true });
    // A check that stopped midway can leave a lane holding the root.
    if (repoId) {
      const released = await account.instance.rpc('solo.release', {
        repoId,
        discardRootChanges: true,
      });
      console.log(`cleanup: solo.release → ${JSON.stringify(released?.error ?? 'released')}`);
    }
    bringProjectDown(root);
    for (const item of items) await account.call('workItems.remove', item.workItem.id);
    for (const item of items) {
      await waitFor(
        async () => (await account.api('GET', `/work-items/${item.workItem.id}`)).status === 404,
        60_000,
        'the cloud to drop the run’s work item'
      );
    }
    await account.close();
    rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
