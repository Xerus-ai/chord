/**
 * Live checks for agent CLI updates in Settings › Agents & models
 * (devstation-ext), driven through the real UI against the CLIs installed on
 * this machine:
 *   - Codex shows "installed → latest" and an "Update Codex to <latest>"
 *     button when its release source has a newer version (and only the version
 *     when it does not);
 *   - every detected npm-installed agent shows its version (on Windows the probe
 *     could not run npm's launchers, so none did), and an Update button exactly
 *     when npm's `latest` is newer than what is installed;
 *   - Claude Code shows its version and never an Update button (it updates
 *     itself).
 *
 *   CHORD_E2E_APP_DIR=.e2e-app-cliup node scripts/e2e/suites/agent-updates.mjs
 *
 * UI contract the checks read: each row carries `data-agent-id` and its agent's
 * name as `aria-label`; the list's "Check for updates" button reads "Checking
 * for updates…" while a check runs.
 *
 * Expected versions are read at run time, independently of the app: each CLI's
 * own `--version`, Codex's release channel (or npm when Codex is npm's), and
 * `npm view` for npm agents. The suite never presses Update — that would
 * upgrade this machine's CLIs; the update itself is covered by
 * `src/main/core/dependencies/agent-updater.test.ts` in a temporary npm prefix.
 * Screenshots: screenshots/e2e/agent-updates-NN-*.png.
 */
import { execSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, extname, join, sep } from 'node:path';
import { E2E_SHOTS_DIR } from '../lib/experience/run-record.mjs';
import { launchSeededApp } from '../lib/seeded-app.mjs';

const SHOTS = E2E_SHOTS_DIR;
mkdirSync(SHOTS, { recursive: true });
let shotCount = 0;
const shot = (name) =>
  join(SHOTS, `agent-updates-${String(++shotCount).padStart(2, '0')}-${name}.png`);

const results = [];
function verdict(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name} — ${detail}`);
}

const CODEX_LATEST_CHANNEL_URL = 'https://releases.openai.com/codex/channels/latest';
const SEMVER = /\b(\d+)\.(\d+)\.(\d+)\b/;

const sh = (command) =>
  execSync(command, {
    encoding: 'utf-8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 30_000,
  }).trim();

function parseVersion(text) {
  const match = SEMVER.exec(text);
  if (!match) throw new Error(`no X.Y.Z version in: ${text.slice(0, 200)}`);
  return match[0];
}

function isNewer(latest, installed) {
  const a = latest.split('.').map(Number);
  const b = installed.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] > b[i];
  }
  return false;
}

/** A CLI's version as its own `--version` prints it, run by name from PATH. */
function cliVersion(binPath) {
  const name = basename(binPath, extname(binPath));
  return parseVersion(sh(`${name} --version`));
}

/** npm's global prefix and package root on this machine. */
function npmGlobal() {
  return { prefix: realpathSync(sh('npm prefix -g')), root: realpathSync(sh('npm root -g')) };
}

/**
 * The npm package an agent binary belongs to, when it is npm's global install,
 * read from the install itself: on Windows npm's launcher (`<bin>.cmd`) names
 * `node_modules\<pkg>\…`; elsewhere the bin is a link into `<root>/<pkg>/…`.
 */
function npmPackageOf(binPath, global) {
  if (process.platform === 'win32') {
    if (realpathSync(dirname(binPath)).toLowerCase() !== global.prefix.toLowerCase()) return null;
    const launcher = extname(binPath) === '.cmd' ? binPath : `${binPath}.cmd`;
    if (!existsSync(launcher)) return null;
    const match = /node_modules\\((?:@[^\\]+\\)?[^\\]+)\\/.exec(readFileSync(launcher, 'utf-8'));
    return match ? match[1].replace('\\', '/') : null;
  }
  const real = realpathSync(binPath);
  if (!real.startsWith(global.root + sep)) return null;
  const match = /^((?:@[^/]+\/)?[^/]+)\//.exec(real.slice(global.root.length + 1));
  return match ? match[1] : null;
}

async function codexLatest(codexPath, global) {
  const pkg = npmPackageOf(codexPath, global);
  if (pkg) return { version: sh(`npm view ${pkg} version`), source: `npm ${pkg}` };
  const response = await fetch(CODEX_LATEST_CHANNEL_URL);
  if (!response.ok) throw new Error(`${CODEX_LATEST_CHANNEL_URL} answered ${response.status}`);
  const { tag_name: tag } = await response.json();
  return { version: tag.replace(/^rust-v/, ''), source: CODEX_LATEST_CHANNEL_URL };
}

/** The agent's row in the CLI agents list, and the name it shows. */
async function agentRow(page, id) {
  const row = page.locator(`[data-agent-id="${id}"]`);
  await row.waitFor({ timeout: 20_000 });
  return { row, name: await row.getAttribute('aria-label') };
}

const updateButtons = (row) => row.getByRole('button', { name: /^Update / });

/**
 * Waits for the list's update check to finish: its "Check for updates" button
 * reads "Checking for updates…" (disabled) while the check runs. Until then a
 * row without an Update button proves nothing.
 */
async function waitForUpdateCheck(page) {
  const button = page.getByRole('button', { name: 'Check for updates', exact: true });
  await button.waitFor({ timeout: 90_000 });
  if (!(await button.isEnabled())) throw new Error('"Check for updates" is shown but disabled');
}

/** Checks one agent's row against the versions read outside the app. */
async function checkRow(page, { id, installed, latest, offersUpdate, label }) {
  const { row, name } = await agentRow(page, id);
  await row.scrollIntoViewIfNeeded();
  await row.screenshot({ path: shot(`row-${id}`) });
  const text = await row.innerText();
  const buttonLabels = await updateButtons(row).evaluateAll((els) =>
    els.map((el) => el.getAttribute('aria-label'))
  );

  if (offersUpdate) {
    verdict(
      `${label}: shows installed → latest`,
      text.includes(`${installed} → ${latest}`),
      `expected "${installed} → ${latest}" in "${text.replace(/\s+/g, ' ')}"`
    );
    verdict(
      `${label}: offers Update to the latest version`,
      buttonLabels.includes(`Update ${name} to ${latest}`),
      `buttons: ${JSON.stringify(buttonLabels)}`
    );
  } else {
    verdict(
      `${label}: shows the installed version`,
      text.includes(installed) && !text.includes('→'),
      `expected "${installed}" and no arrow in "${text.replace(/\s+/g, ' ')}"`
    );
    verdict(
      `${label}: offers no Update`,
      buttonLabels.length === 0,
      `buttons: ${JSON.stringify(buttonLabels)}`
    );
  }
}

async function main() {
  const instance = await launchSeededApp({ source: 'built', profilePrefix: 'chord-agent-updates' });
  const { page, rpc } = instance;
  try {
    await page.getByTitle('Settings', { exact: true }).click();
    await page.getByRole('button', { name: 'Agents & models', exact: true }).first().click();
    await page.locator('[data-agent-id]').first().waitFor({ timeout: 20_000 });

    // Which agents the app found, and where; versions are read outside the app.
    const statuses = await rpc('dependencies.getAll');
    const detected = Object.values(statuses).filter(
      (s) => s.category === 'agent' && s.status === 'available' && s.path
    );
    const global = npmGlobal();
    console.log(`npm global: ${global.prefix}`);
    console.log(`detected agents: ${detected.map((s) => `${s.id} (${s.path})`).join(', ')}`);

    await waitForUpdateCheck(page);
    await page.screenshot({ path: shot('agents-list') });

    const codex = detected.find((s) => s.id === 'codex');
    if (!codex) throw new Error('Codex is not detected on this machine; the suite needs it');
    const codexInstalled = cliVersion(codex.path);
    const codexNewest = await codexLatest(codex.path, global);
    console.log(
      `codex ${codexInstalled} (${codex.path}); latest ${codexNewest.version} from ${codexNewest.source}`
    );
    await checkRow(page, {
      id: 'codex',
      installed: codexInstalled,
      latest: codexNewest.version,
      offersUpdate: isNewer(codexNewest.version, codexInstalled),
      label: 'Codex',
    });

    const npmAgents = detected
      .filter((s) => s.id !== 'codex' && s.id !== 'claude')
      .map((s) => ({ ...s, pkg: npmPackageOf(s.path, global) }))
      .filter((s) => s.pkg);
    verdict(
      'at least one npm-installed agent is detected',
      npmAgents.length > 0,
      npmAgents.map((s) => `${s.id} = ${s.pkg}`).join(', ') || 'none'
    );
    for (const agent of npmAgents) {
      const installed = cliVersion(agent.path);
      const latest = sh(`npm view ${agent.pkg} version`);
      console.log(`${agent.id} ${installed}; npm latest ${latest} (${agent.pkg})`);
      await checkRow(page, {
        id: agent.id,
        installed,
        latest,
        offersUpdate: isNewer(latest, installed),
        label: `${agent.id} (npm ${agent.pkg})`,
      });
    }

    const claude = detected.find((s) => s.id === 'claude');
    if (claude) {
      await checkRow(page, {
        id: 'claude',
        installed: cliVersion(claude.path),
        latest: null,
        offersUpdate: false,
        label: 'Claude Code',
      });
      // The row's expander names what it counts; a bare "› 11" beside the
      // version read as part of it (devstation-nj4).
      const { row } = await agentRow(page, 'claude');
      const rowText = (await row.innerText()).replace(/\s+/g, ' ');
      verdict(
        'Claude Code: the skills/commands expander says what it counts',
        /\b\d+ (skill|command)s?\b/.test(rowText),
        rowText
      );
    } else {
      verdict('Claude Code is detected', false, 'not detected on this machine');
    }

    // `droid --version` installs an update before printing; with Droid's
    // updater off it prints at once (devstation-nj4). The expected version is
    // read the same way, so this suite never updates Droid either.
    const droid = detected.find((s) => s.id === 'droid');
    if (droid) {
      const installed = parseVersion(
        execSync('droid --version', {
          encoding: 'utf-8',
          stdio: ['ignore', 'pipe', 'pipe'],
          timeout: 30_000,
          env: { ...process.env, FACTORY_DROID_AUTO_UPDATE_ENABLED: 'false' },
        })
      );
      await checkRow(page, {
        id: 'droid',
        installed,
        latest: null,
        offersUpdate: false,
        label: 'Droid',
      });
    } else {
      console.log('droid is not detected on this machine: its row is not checked');
    }

    // devstation-fez: install commands follow the platform. On Windows a
    // vendor with no Windows installer (Goose) offers none, and one with a
    // PowerShell installer (Hermes) offers its own.
    if (process.platform === 'win32') {
      for (const [id, offered] of [
        ['goose', false],
        ['hermes', true],
      ]) {
        const { row, name } = await agentRow(page, id);
        if ((await row.innerText()).includes('Not detected')) {
          await row.scrollIntoViewIfNeeded();
          // Each offer is one button: its tooltip trigger renders as the button
          // rather than wrapping it in another (devstation-lk24).
          const offers = (label) => row.getByRole('button', { name: label }).count();
          const copy = await offers(`Copy install command for ${name}`);
          const install = await offers(/^Install /);
          await row.screenshot({ path: shot(`row-${id}-install`) });
          verdict(
            `fez: ${name} ${offered ? 'offers its Windows installer' : 'offers no install command on Windows'}`,
            offered ? copy === 1 && install === 1 : copy === 0 && install === 0,
            `copy buttons ${copy}, install buttons ${install}`
          );
        } else {
          console.log(`${id} is installed here: its install offer is not checked`);
        }
      }
    }

    await page.locator('[data-agent-id="codex"]').scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot('agents-list-checked') });
  } catch (error) {
    // What the user was looking at when a check could not go on.
    await page.screenshot({ path: shot('failure') });
    throw error;
  } finally {
    await instance.close();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  if (failed.length > 0) process.exitCode = 1;
}

await main();
