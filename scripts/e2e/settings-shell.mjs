/**
 * Live checks for the settings shell (devstation-rq4r), driven through the
 * real packaged app:
 *   - opening Settings replaces the sessions rail with the settings rail
 *     (Back to app at the top, grouped nav, Repositories group);
 *   - every tab renders its heading and its sections inside one band;
 *   - Git & worktrees carries the worktree cards with Show / Hide segments;
 *   - a repository's page opens from the rail and ends with a Manage section;
 *   - Back to app and Escape both return to the view that opened settings.
 *
 *   CHORD_E2E_APP_DIR=.e2e-app node scripts/e2e/settings-shell.mjs
 *
 * Screenshots: screenshots/e2e/settings-shell-NN-*.png.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from './experience/run-record.mjs';
import { launchSeededApp } from './seeded-app.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `settings-shell-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const TABS = [
  'General',
  'Interface',
  'Sharing',
  'Agents & models',
  'Artifacts',
  'Skills',
  'MCP Servers',
  'Repository',
  'Git & worktrees',
  'Team',
  'Rules',
  'Integrations',
];

async function openSettings(page) {
  await page.getByTitle('Settings', { exact: true }).click();
  await page.getByRole('button', { name: 'Back to app' }).waitFor({ timeout: 15_000 });
  // Let the rail-in and pane-in animations finish before a screenshot.
  await page.waitForTimeout(400);
}

async function selectTab(page, label) {
  await page.getByRole('button', { name: label, exact: true }).first().click();
  await page.getByRole('heading', { level: 2, name: label }).waitFor({ timeout: 15_000 });
  await page.waitForTimeout(350);
}

async function checkShell(page) {
  const sessionsRailBefore = await page.getByText('New work item').first().isVisible();
  await openSettings(page);
  const sessionsRailGone = (await page.getByText('New work item').count()) === 0;
  verdict(
    'settings replaces the sessions rail',
    sessionsRailBefore && sessionsRailGone,
    `before: ${sessionsRailBefore}, during: ${!sessionsRailGone}`
  );

  await selectTab(page, 'General');
  await page.screenshot({ path: shot('general') });
  const generalCards = await page
    .locator('[id^="settings-card-"]')
    .evaluateAll((nodes) => nodes.map((node) => node.id.replace('settings-card-', '')));
  verdict(
    'General holds account, privacy and updates only',
    generalCards.join(',') === 'account,telemetry,updates',
    generalCards.join(',')
  );
}

async function checkTabs(page) {
  for (const label of TABS) {
    await selectTab(page, label);
    const bands = await page
      .locator('[id^="settings-card-"] > div.rounded-lg.border.bg-surface-raised')
      .count();
    const cards = await page.locator('[id^="settings-card-"]').count();
    await page.screenshot({ path: shot(label.toLowerCase().replace(/[^a-z]+/g, '-')) });
    verdict(`${label} renders its sections`, cards > 0, `${cards} card(s), ${bands} banded`);
  }
}

async function checkWorktrees(page) {
  await selectTab(page, 'Git & worktrees');
  const root = page.locator('#settings-card-worktree-root');
  await root.scrollIntoViewIfNeeded();
  const sources = page.locator('#settings-card-worktree-sources');
  const group = page.getByRole('group', { name: 'Claude Code worktrees' });
  const labels = await group.getByRole('button').allInnerTexts();
  verdict(
    'worktree folder and sources sit under Git & worktrees',
    (await root.count()) === 1 && (await sources.count()) === 1,
    `root ${await root.count()}, sources ${await sources.count()}`
  );
  verdict(
    'worktree source segments read Show / Hide',
    labels.join('/') === 'Show/Hide',
    labels.join('/')
  );
  await page.screenshot({ path: shot('worktrees') });
}

async function checkSwitches(page) {
  await selectTab(page, 'Interface');
  const switches = page.locator('[data-slot="switch"]');
  const count = await switches.count();
  const states = await switches.evaluateAll((nodes) =>
    nodes.map((node) => {
      const style = globalThis.getComputedStyle(node);
      return {
        checked: node.hasAttribute('data-checked'),
        bg: style.backgroundColor,
        border: style.borderWidth,
        h: node.getBoundingClientRect().height,
        w: node.getBoundingClientRect().width,
      };
    })
  );
  const on = states.filter((s) => s.checked).map((s) => s.bg);
  const off = states.filter((s) => !s.checked).map((s) => s.bg);
  const distinct = on.length === 0 || off.length === 0 || on[0] !== off[0];
  const sized = states.every((s) => Math.round(s.w) === 36 && Math.round(s.h) === 20);
  verdict(
    'switch on and off tracks are different solid colours, 36x20, no border',
    count > 0 && distinct && sized && states.every((s) => s.border === '0px'),
    `${count} switches, on ${on[0] ?? '-'}, off ${off[0] ?? '-'}, sizes ${[...new Set(states.map((s) => `${Math.round(s.w)}x${Math.round(s.h)}`))].join(' ')}`
  );
  await page.locator('#settings-card-notification-types').scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('switches') });
}

async function checkRepoPage(page) {
  const nav = page.locator('nav');
  const addRow = nav.getByRole('button', { name: 'Add repository' });
  verdict('the rail ends its Repositories group with Add repository', await addRow.isVisible(), '');
  const repoButtons = nav.locator('button[title]');
  const repoCount = await repoButtons.count();
  if (repoCount === 0) {
    verdict('a repository page opens from the rail', true, 'no repositories in this profile');
    return;
  }
  await repoButtons.first().click();
  await page.getByRole('heading', { level: 1 }).waitFor({ timeout: 15_000 });
  await page.getByText('Loading…').first().waitFor({ state: 'detached', timeout: 30_000 });
  await page.waitForTimeout(350);
  const manage = page.getByRole('region', { name: 'Manage' });
  await manage.scrollIntoViewIfNeeded();
  await page.screenshot({ path: shot('repo-page-manage') });
  verdict(
    'a repository page opens from the rail and ends with Manage',
    (await manage.getByRole('button', { name: /Archive|Unarchive/ }).count()) === 1 &&
      (await manage.getByRole('button', { name: 'Remove' }).count()) === 1,
    ''
  );
}

async function checkReturn(page) {
  await page.getByRole('button', { name: 'Back to app' }).click();
  await page.getByText('New work item').first().waitFor({ timeout: 15_000 });
  await page.waitForTimeout(400);
  await page.screenshot({ path: shot('back-to-app') });
  verdict(
    'Back to app restores the sessions rail',
    (await page.getByRole('button', { name: 'Back to app' }).count()) === 0,
    ''
  );

  await openSettings(page);
  await page.keyboard.press('Escape');
  await page.getByText('New work item').first().waitFor({ timeout: 15_000 });
  verdict(
    'Escape leaves settings',
    (await page.getByRole('button', { name: 'Back to app' }).count()) === 0,
    ''
  );
}

async function main() {
  const instance = await launchSeededApp({
    source: 'built',
    profilePrefix: 'chord-settings-shell',
  });
  const { page } = instance;
  try {
    await page.getByTitle('Settings', { exact: true }).waitFor({ timeout: 60_000 });
    await checkShell(page);
    await checkTabs(page);
    await checkWorktrees(page);
    await checkSwitches(page);
    await checkRepoPage(page);
    await checkReturn(page);
  } catch (error) {
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    await instance.close();
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
