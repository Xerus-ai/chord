/**
 * Live checks for agent CLIs opened in a terminal, driven through the real UI
 * (Settings › Open agents in › Terminal, then the + menu's Claude Code and
 * Codex rows):
 *   - devstation-bmj: starting them leaves the lane clean — no
 *     "uncommitted file", no Commit, `git status` empty, no Chord file in the
 *     checkout, the committed .gitignore untouched;
 *   - devstation-tx0: Codex is launched with Chord's notify as a `-c`
 *     override, and Claude Code with Chord's hooks in its `--settings` file;
 *   - devstation-jop: the centre tab, the right rail's worktree row and the
 *     sidebar row read "Claude Code" / "Codex", never "Terminal", "Session"
 *     or "Agent session".
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-agent-terminals node scripts/e2e/suites/agent-terminals.mjs
 *
 * Uses a scratch repository (a bare origin plus a clone) under the OS temp
 * folder. Its work item is deleted in the app, and the suite waits until the
 * cloud no longer has it. Screenshots: <e2e out>/screenshots/agent-terminals-*.png.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { readBandState } from '../lib/band-state.mjs';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { assertServerHealthy, launchAccount, waitFor } from '../lib/sharing/sharing-accounts.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `agent-terminals-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const GITIGNORE = 'node_modules/\n';
const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();
// eslint-disable-next-line no-control-regex
const stripAnsi = (text) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*\x07/g, '');

/** origin (bare) with main = [README, .gitignore]; the clone Chord adds as the repository. */
function createScratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'chord-agent-terminals-'));
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'agent-terminals');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# agent terminals\n');
  writeFileSync(join(author, '.gitignore'), GITIGNORE);
  git(author, 'add', 'README.md', '.gitignore');
  git(author, 'commit', '-q', '-m', 'init');
  git(author, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  const emptyExcludes = join(root, 'empty-excludes');
  writeFileSync(emptyExcludes, '');
  return { root, repo, emptyExcludes };
}

/**
 * The lane's status with the machine's global excludes off: Claude Code adds
 * `**\/.claude/settings.local.json` to them, which would hide a file Chord
 * wrote into the checkout. The rest of the machine's config (autocrlf, which
 * checked the lane out) stays, as it does for the app.
 */
function laneStatus(lanePath, emptyExcludes) {
  return execFileSync(
    'git',
    ['-c', `core.excludesFile=${emptyExcludes}`, 'status', '--porcelain', '--untracked-files=all'],
    { cwd: lanePath, stdio: 'pipe' }
  )
    .toString()
    .trim();
}

/** Command lines of running processes whose image name starts with `name`. */
function processCommandLines(name) {
  if (process.platform === 'win32') {
    const out = execFileSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-Command',
        `Get-CimInstance Win32_Process -Filter "Name LIKE '${name}%'" | ForEach-Object { $_.CommandLine }`,
      ],
      { stdio: 'pipe' }
    ).toString();
    return out.split(/\r?\n/).filter((line) => line.trim().length > 0);
  }
  return execFileSync('ps', ['-eo', 'args'], { stdio: 'pipe' })
    .toString()
    .split('\n')
    .filter((line) => line.includes(name));
}

/** The terminal's ring buffer (consumers are per session; not unsubscribed). */
async function readPtyText(account, sessionId) {
  const { buffer } = await account.call('pty.subscribe', `session:${sessionId}`);
  return stripAnsi(buffer);
}

async function openAgentTerminal(account, page, workItem, { providerId, rowName, firstScreen }) {
  await page.getByRole('button', { name: 'New session' }).click();
  // The row's title also says the setting is followed (Open agents in › Terminal).
  const row = page.locator(`[role="menuitem"][title="Open ${rowName} in a terminal"]`);
  await row.waitFor({ timeout: 15_000 });
  await row.click();

  let terminal = null;
  await waitFor(
    async () => {
      const { sessions } = await account.call('agentSessions.getAll', workItem.id);
      terminal = sessions.find((s) => s.kind === 'terminal' && s.agentProviderId === providerId);
      return Boolean(terminal);
    },
    30_000,
    `a ${rowName} terminal session`
  );
  await waitFor(
    async () => firstScreen.test(await readPtyText(account, terminal.id)),
    90_000,
    `${rowName} to draw its first screen`
  );
  return terminal;
}

async function checkLaneClean(page, lanePath, scratch, label, bandBefore) {
  // The band reads git status on a poll; give it a few beats after the CLI started.
  await page.waitForTimeout(6000);
  const status = laneStatus(lanePath, scratch.emptyExcludes);
  verdict(`${label}: git status of the lane is empty`, status === '', status || 'clean');
  const chordFiles = ['.claude/settings.local.json', '.codex/config.toml'].filter((file) =>
    existsSync(join(lanePath, file))
  );
  verdict(
    `${label}: no Chord agent config in the checkout`,
    chordFiles.length === 0,
    chordFiles.length === 0 ? 'none' : chordFiles.join(', ')
  );
  verdict(
    `${label}: the committed .gitignore is untouched`,
    // In the line endings git checked it out with (autocrlf); git status above
    // says whether its content changed.
    readFileSync(join(lanePath, '.gitignore'), 'utf8').replace(/\r\n/g, '\n') === GITIGNORE,
    JSON.stringify(readFileSync(join(lanePath, '.gitignore'), 'utf8'))
  );
  const uncommitted = await page.getByText(/uncommitted file/).count();
  const commit = await page.getByRole('button', { name: 'Commit', exact: true }).count();
  verdict(
    `${label}: the lane shows no uncommitted file and no Commit`,
    uncommitted === 0 && commit === 0,
    `"uncommitted file" ×${uncommitted}, Commit ×${commit}`
  );
  const bandState = await readBandState(page);
  verdict(
    `${label}: the band reads as it did before the agent started`,
    bandState === bandBefore && !/uncommitted/.test(bandState ?? ''),
    `before "${bandBefore}", now "${bandState}"`
  );
}

function checkLaunchFlags(claudeTerminal) {
  const claudeLine = processCommandLines('claude').find((line) =>
    line.includes(`${claudeTerminal.id}.settings.json`)
  );
  const settingsPath = claudeLine?.match(/--settings\s+(?:"([^"]+)"|(\S+))/);
  const file = settingsPath ? (settingsPath[1] ?? settingsPath[2]) : null;
  const hooks = file && existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')).hooks : null;
  verdict(
    'tx0/bmj: Claude Code runs with Chord’s hooks in its --settings file',
    Boolean(hooks?.Stop?.length && hooks?.Notification?.length) &&
      JSON.stringify(hooks).includes('CHORD_HOOK_PORT'),
    file ?? 'no claude process with this session’s --settings'
  );
  const codexLine = processCommandLines('codex').find((line) => line.includes('notify='));
  verdict(
    'tx0: Codex runs with notify as a -c override',
    Boolean(codexLine) &&
      (codexLine.includes('chord-codex-notify') || codexLine.includes('CHORD_HOOK_PORT')),
    codexLine
      ? codexLine.slice(codexLine.indexOf('notify='), codexLine.indexOf('notify=') + 120)
      : 'none'
  );
}

async function checkLabels(page) {
  for (const name of ['Claude Code', 'Codex']) {
    const tab = page.getByRole('tab').filter({ hasText: name });
    const tabCount = await tab.count();
    verdict(`jop: a centre tab reads ${name}`, tabCount >= 1, `${tabCount} tab(s)`);

    const rail = page.getByRole('tabpanel', { name: 'Work item' });
    verdict(
      `jop: the right rail's worktree row reads ${name}`,
      await rail.getByText(name, { exact: true }).first().isVisible(),
      'row in Worktrees'
    );

    // The sidebar is the column left of the centre strip. Its summaries are
    // polled every 10s (use-sidebar-summaries.ts), so a session started just
    // now may take one poll to appear.
    const tabBox = tabCount >= 1 ? await tab.first().boundingBox() : null;
    const countSidebarRows = async () => {
      let rows = 0;
      for (const el of await page.getByText(name, { exact: true }).all()) {
        const box = await el.boundingBox();
        if (box && tabBox && box.x + box.width <= tabBox.x) rows += 1;
      }
      return rows;
    };
    let inSidebar = await countSidebarRows();
    for (const deadline = Date.now() + 15_000; inSidebar === 0 && Date.now() < deadline; ) {
      await page.waitForTimeout(500);
      inSidebar = await countSidebarRows();
    }
    verdict(`jop: the sidebar row reads ${name}`, inSidebar >= 1, `${inSidebar} row(s)`);
  }
  const terminalTabs = await page.getByRole('tab', { name: 'Terminal', exact: true }).count();
  const sessionRows = await page.getByText('Session', { exact: true }).count();
  const agentSessionRows = await page.getByText('Agent session', { exact: true }).count();
  verdict(
    'jop: no tab "Terminal", no row "Session" or "Agent session"',
    terminalTabs === 0 && sessionRows === 0 && agentSessionRows === 0,
    `Terminal ×${terminalTabs}, Session ×${sessionRows}, Agent session ×${agentSessionRows}`
  );
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratchRepo();
  const account = await launchAccount({ seedProfile: 'chord-p1-smoke', label: 'agent-terminals' });
  const { page } = account.instance;
  let workItem = null;
  const terminals = [];
  try {
    const { repo } = await account.call('repos.create', {
      path: scratch.repo,
      alias: 'agent-terminals',
    });
    await account.instance.rpc('appSettings.update', 'agentLaunch', { openAgentsIn: 'terminal' });

    const created = await account.call('workItems.create', {
      name: `Chord e2e agent terminals ${Date.now()}`,
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
    const { worktrees } = await account.call('worktrees.list', workItem.id);
    const lanePath = resolve(worktrees.find((w) => w.isPrimary).path);

    await page.getByText(workItem.name, { exact: true }).first().click();
    // The lane's branch is never pushed in this run, so the settled band reads
    // Not published (it read "Pushed · no pull request" only through
    // devstation-dh2). Wait for it, so the band's state before and after an
    // agent differs only by what the agent's start did.
    let bandBefore = null;
    await waitFor(
      async () => (bandBefore = await readBandState(page)) === 'Not published',
      60_000,
      'the band to read Not published'
    );
    console.log(`band before any agent: ${bandBefore}`);
    await page.screenshot({ path: shot('lane-before') });

    const claude = await openAgentTerminal(account, page, workItem, {
      providerId: 'claude',
      rowName: 'Claude Code',
      // Its header and input hint, or its own folder-trust dialog.
      firstScreen: /trust the files|shift\s*\+\s*tab/i,
    });
    terminals.push(claude);
    await checkLaneClean(page, lanePath, scratch, 'after Claude Code', bandBefore);
    await page.screenshot({ path: shot('claude-terminal') });

    const codex = await openAgentTerminal(account, page, workItem, {
      providerId: 'codex',
      rowName: 'Codex',
      // Its header, or its own trust / sign-in screen.
      firstScreen: /OpenAI Codex|trust|sign in/i,
    });
    terminals.push(codex);
    await checkLaneClean(page, lanePath, scratch, 'after Codex', bandBefore);
    await page.screenshot({ path: shot('codex-terminal') });
    // devstation-xr1: Chord records the lane as trusted in Codex's config, so
    // Codex opens on its own screen, not on "Do you trust the contents…".
    const codexScreen = await readPtyText(account, codex.id);
    verdict(
      'xr1: Codex opens without its folder-trust prompt',
      !/Do you trust the contents/i.test(codexScreen) && /OpenAI Codex/i.test(codexScreen),
      codexScreen.replace(/\s+/g, ' ').slice(0, 160)
    );

    checkLaunchFlags(claude);
    await checkLabels(page);
    await page.screenshot({ path: shot('labels') });
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    for (const terminal of terminals) await account.call('agentSessions.remove', terminal.id);
    if (workItem) {
      await account.call('workItems.remove', workItem.id);
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
