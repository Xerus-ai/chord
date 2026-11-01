/**
 * Live check for plan §Phase 3 slice 5 (devstation-arx.7), driven through the
 * real UI: a Claude session started outside Chord in a lane's folder is found,
 * imported with its history, and continues the same conversation.
 *
 *   1. A lane is created; `claude -p` runs in its folder, outside Chord, and
 *      is told a code word.
 *   2. The rail's Work item tab lists that session under the lane, in "Found
 *      on this machine", and names the agents that can't be imported.
 *   3. Import opens the chat with the earlier prompt and reply in it.
 *   4. A follow-up asks for the code word; the reply has it, and Claude's own
 *      transcript for that session id holds the follow-up (same conversation,
 *      not a new one).
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-session-import node scripts/e2e/session-import.mjs
 *
 * Uses a scratch repository (a bare origin plus a clone) under the OS temp
 * folder. Its work item is deleted in the app and the suite waits until the
 * cloud no longer has it; the Claude project folder the outside session wrote
 * for the lane is removed. Screenshots: screenshots/e2e/session-import-*.png.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { E2E_SHOTS_DIR } from './experience/run-record.mjs';
import { assertServerHealthy, launchAccount, waitFor } from './sharing/sharing-accounts.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `session-import-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const git = (cwd, ...args) => execFileSync('git', args, { cwd, stdio: 'pipe' }).toString().trim();

/** origin (bare) with main = [readme]; the clone Chord registers. No .chord.json: no trust prompt. */
function createScratchRepo() {
  const root = mkdtempSync(join(tmpdir(), 'chord-session-import-'));
  const origin = join(root, 'origin.git');
  const author = join(root, 'author');
  const repo = join(root, 'session-import');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  git(root, 'clone', '-q', origin, author);
  git(author, 'config', 'user.email', 'e2e@chord.invalid');
  git(author, 'config', 'user.name', 'Chord e2e');
  git(author, 'checkout', '-q', '-b', 'main');
  writeFileSync(join(author, 'README.md'), '# session import\n');
  git(author, 'add', 'README.md');
  git(author, 'commit', '-q', '-m', 'readme');
  git(author, 'push', '-q', 'origin', 'main');
  git(root, 'clone', '-q', origin, repo);
  git(repo, 'config', 'user.email', 'e2e@chord.invalid');
  git(repo, 'config', 'user.name', 'Chord e2e');
  return { root, repo };
}

/**
 * The folder Claude Code writes a cwd's transcripts to: every character
 * outside [A-Za-z0-9] as `-`. Scratch lane paths stay under the 200-character
 * cap, past which the SDK appends a hash; refuse rather than guess.
 */
function claudeProjectDir(cwd) {
  const encoded = cwd.replace(/[^A-Za-z0-9]/g, '-');
  if (encoded.length > 200) throw new Error(`lane path too long for this suite: ${cwd}`);
  const configDir = process.env.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), '.claude');
  return join(configDir, 'projects', encoded);
}

/** `claude -p` in `cwd`, prompt on stdin (no shell quoting), JSON result. */
function runOutsideClaude(cwd, prompt) {
  const run = spawnSync('claude', ['-p', '--output-format', 'json'], {
    cwd,
    input: prompt,
    encoding: 'utf8',
    shell: process.platform === 'win32',
    timeout: 180_000,
  });
  if (run.status !== 0) {
    throw new Error(`claude -p exited ${run.status}: ${run.stderr || run.stdout}`);
  }
  return JSON.parse(run.stdout);
}

/** The visible text of an agent_turn row's items. */
function turnText(row) {
  const { items } = JSON.parse(row.metadata ?? '{}');
  return (items ?? [])
    .filter((item) => item.kind === 'text')
    .map((item) => item.text)
    .join('\n');
}

async function main() {
  await assertServerHealthy();
  const scratch = createScratchRepo();
  const account = await launchAccount({ seedProfile: 'chord-p1-smoke', label: 'session-import' });
  const { page } = account.instance;
  const codeWord = `QUOKKA${randomInt(1000, 9999)}`;
  let workItem = null;
  let projectDir = null;
  try {
    const { repo } = await account.call('repos.create', {
      path: scratch.repo,
      alias: 'session-import',
    });
    const created = await account.call('workItems.create', {
      name: `Chord e2e session import ${Date.now()}`,
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
    const lane = worktrees.find((w) => w.isPrimary);
    const lanePath = resolve(lane.path);
    projectDir = claudeProjectDir(lanePath);

    // 1. Outside Chord: plain `claude` in the lane's folder.
    const outside = runOutsideClaude(
      lanePath,
      `Remember the code word ${codeWord}. Reply with just: ok`
    );
    const outsideId = outside.session_id;
    verdict(
      'an outside Claude session ran in the lane folder',
      typeof outsideId === 'string' && existsSync(join(projectDir, `${outsideId}.jsonl`)),
      `session ${outsideId}, reply ${JSON.stringify(outside.result)}`
    );

    // 2. The lane lists it.
    await page.getByText(workItem.name, { exact: true }).first().click();
    await page.getByRole('tab', { name: /^Work item/ }).click();
    const found = page.locator(
      `[data-testid="found-session"][data-provider-session-id="${outsideId}"]`
    );
    await found.waitFor({ timeout: 60_000 });
    await found.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot('found-on-this-machine') });
    verdict(
      'the lane lists the outside session under Found on this machine',
      (await page.getByText('Found on this machine').first().isVisible()) &&
        (await found.innerText()).includes(codeWord),
      (await found.innerText()).replace(/\s+/g, ' ')
    );
    const unable = page.getByText(/can't be imported/).first();
    verdict(
      'agents that cannot list sessions are named',
      (await unable.isVisible()) && /Gemini/.test(await unable.innerText()),
      (await unable.innerText()).replace(/\s+/g, ' ')
    );

    // 3. Import.
    await found.getByRole('button', { name: 'Import' }).click();
    let imported = null;
    await waitFor(
      async () => {
        const { sessions } = await account.call('agentSessions.getAll', workItem.id);
        imported = sessions.find((s) => s.externalSessionId === outsideId);
        return imported !== undefined;
      },
      60_000,
      'the imported chat session'
    );
    verdict(
      'Import made a Claude chat on the lane holding the outside session id',
      imported.kind === 'chat' &&
        imported.agentProviderId === 'claude' &&
        imported.worktreeId === lane.id,
      `session ${imported.id} (${imported.status}) on lane ${imported.worktreeId}`
    );
    const earlierPrompt = page.getByText(`Remember the code word ${codeWord}`).first();
    await earlierPrompt.waitFor({ timeout: 30_000 });
    await page.screenshot({ path: shot('imported-chat') });
    const { messages: importedRows } = await account.call('chatMessages.getMessages', workItem.id, {
      sessionId: imported.id,
    });
    const own = importedRows.filter((row) => row.sessionId === imported.id);
    verdict(
      'the chat shows the earlier prompt and reply',
      (await earlierPrompt.isVisible()) &&
        own.length === 2 &&
        own[0].senderType === 'human' &&
        own[1].messageType === 'agent_turn' &&
        /ok/i.test(turnText(own[1])),
      own.map((row) => `${row.senderType}:${row.content || turnText(row)}`).join(' | ')
    );
    verdict(
      'the imported session is no longer offered',
      (await found.count()) === 0,
      `found rows for ${outsideId}: ${await found.count()}`
    );

    // 4. Same conversation.
    const composer = page.getByPlaceholder(/^Message the agent/).first();
    await composer.waitFor({ timeout: 30_000 });
    await composer.click();
    const followUp = 'What was the code word I asked you to remember? Reply with just the word.';
    await composer.fill(followUp);
    await composer.press('Enter');
    let reply = '';
    await waitFor(
      async () => {
        const { messages } = await account.call('chatMessages.getMessages', workItem.id, {
          sessionId: imported.id,
        });
        const turns = messages.filter(
          (row) => row.sessionId === imported.id && row.messageType === 'agent_turn'
        );
        reply = turns.length > 1 ? turnText(turns[turns.length - 1]) : '';
        return reply.length > 0;
      },
      240_000,
      'the reply to the follow-up'
    );
    await page.getByText(codeWord, { exact: false }).last().waitFor({ timeout: 30_000 });
    await page.screenshot({ path: shot('follow-up-reply') });
    verdict(
      'the reply names the code word from before the import',
      reply.toUpperCase().includes(codeWord),
      `reply: ${JSON.stringify(reply)}`
    );
    const { sessions: after } = await account.call('agentSessions.getAll', workItem.id);
    const afterRow = after.find((s) => s.id === imported.id);
    const transcript = readFileSync(join(projectDir, `${outsideId}.jsonl`), 'utf8');
    verdict(
      'the follow-up continued the same Claude session',
      afterRow?.externalSessionId === outsideId && transcript.includes(followUp),
      `row external id ${afterRow?.externalSessionId}; transcript has follow-up: ${transcript.includes(followUp)}`
    );
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
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
    // Only the folder the outside session wrote for this run's lane path.
    if (projectDir && projectDir.includes('session-import')) {
      rmSync(projectDir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
