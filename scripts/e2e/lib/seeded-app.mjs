/* global window -- page.evaluate callbacks run inside the app window */
/**
 * Launches the PACKAGED app under a throw-away profile seeded from an existing
 * signed-in one, for the artifact done-checks (plan 2026-09-23 §7).
 *
 * The probes drive the real UI, which sits behind sign-in, so the seed copies
 * the database plus the Chromium storage that holds the session. Caches are
 * skipped. The profile is deleted on close. A seed whose session has lapsed is
 * refused at launch, naming the profile and how to sign it in again.
 */
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron } from 'playwright';
import { E2E_VIDEO_DIR, recordRunOnExit } from './experience/run-record.mjs';
import { pruneScratchCodexTrust } from './prune-scratch-trust.mjs';
import { reapOrphanedApps } from './reap-orphaned-apps.mjs';
import { returnSessionToSeed } from './seed-session.mjs';
// The packaged app requires the WorkOS/cloud env at launch (main/core/account/
// require-env.ts throws when app.isPackaged and a variable is missing), so the
// probe loads the repo's .env the same way `pnpm run dev` does.
import 'dotenv/config';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

const SEED_ENTRIES = [
  'chord.db',
  'chord.db-wal',
  'chord.db-shm',
  'Preferences',
  'Local State',
  'Local Storage',
  'Session Storage',
  'Network',
  'IndexedDB',
  'WebStorage',
];

/** How to sign a seed profile in again (the e2e handoffs' re-seed steps). */
function reseedSteps(seedProfile) {
  return (
    `Re-seed it: CHORD_PROFILE=${seedProfile} CHORD_FORCE_FRESH_LOGIN=1 pnpm run dev, ` +
    'Sign Out under Settings → General → Account, paste the copied sign-in URL into a ' +
    'fresh incognito window and pick the account, then close the app.'
  );
}

/**
 * A seed must hold a live session, not only a remembered account: WorkOS ends
 * a session after inactivity, and the app then still names the account while
 * every cloud call fails (devstation-bub). The app hands out no token once
 * its refresh has failed (chord-account-service.ts getAccessToken), so that is
 * the check, before any check runs: a lapsed seed is named at once rather than
 * failing a suite halfway.
 */
async function assertSeedSignedIn(instance, seedProfile) {
  const session = await instance.rpc('account.getSession');
  const email = session?.user?.email;
  if (!email) {
    throw new Error(`Seed profile ${seedProfile} is not signed in. ${reseedSteps(seedProfile)}`);
  }
  const token = await instance.rpc('account.getAccessToken');
  if (typeof token !== 'string' || !token) {
    throw new Error(
      `Seed profile ${seedProfile} (${email}) has no live session: its WorkOS session ended ` +
        `(after inactivity, or spent by a run that refreshed it and could not hand it back: ` +
        `seed-session.mjs). ${reseedSteps(seedProfile)}`
    );
  }
  return session;
}

/**
 * Where the app comes from:
 *   packaged — `release/win-unpacked/Chord.exe` (or `exe`), the default
 *   built    — an electron-vite build run by the repo's Electron. The app root
 *              is `appDir` (default: the repo, i.e. `out/`, which `pnpm run dev`
 *              also writes); `CHORD_E2E_APP_DIR` or `appDir` points at a root of
 *              its own (`node scripts/e2e/lib/build-e2e-app.mjs`) so a probe and a
 *              dev session never overwrite each other's bundle. The single-
 *              instance lock is per profile, so the two-account sharing check
 *              runs two side by side.
 */
function resolveLaunchTarget(source, exe, appDir) {
  if (source === 'built') {
    for (const file of ['out/main/index.js', 'out/renderer/index.html']) {
      if (!existsSync(join(appDir, file))) {
        throw new Error(`${join(appDir, file)} is missing (build it first)`);
      }
    }
    return {
      executablePath: join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe'),
      args: [appDir, '--no-sandbox'],
    };
  }
  const executablePath = exe ?? join(ROOT, 'release', 'win-unpacked', 'Chord.exe');
  if (!existsSync(executablePath)) {
    throw new Error(`Packaged app not found: ${executablePath} (run pnpm run package:win)`);
  }
  return { executablePath, args: ['--no-sandbox'] };
}

/**
 * `reopenProfile`: the name of a profile an earlier launch closed with
 * `close({ keepProfile: true })`, launched again as it was left — a restart.
 * Without it, a fresh profile is copied from the seed.
 *
 * @param {{ exe?: string, source?: 'packaged' | 'built', appDir?: string, seedProfile?: string,
 *           profilePrefix?: string, reopenProfile?: string, env?: Record<string, string> }} options
 */
export async function launchSeededApp({
  exe,
  source = 'packaged',
  appDir = process.env.CHORD_E2E_APP_DIR ?? ROOT,
  seedProfile = process.env.CHORD_E2E_SEED_PROFILE ?? 'chord-p1-smoke',
  profilePrefix,
  reopenProfile,
  env = {},
}) {
  const target = resolveLaunchTarget(source, exe, resolve(appDir));
  recordRunOnExit();
  for (const reaped of await reapOrphanedApps(target.executablePath)) {
    console.log(
      `reaped an app left by a killed run: pid ${reaped.pid}, profile ${reaped.profileDir}`
    );
  }
  reportPrunedTrust(pruneScratchCodexTrust());
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is not set');

  const seedDir = join(appData, seedProfile);
  if (!existsSync(join(seedDir, 'chord.db'))) {
    throw new Error(`Seed profile has no database: ${join(seedDir, 'chord.db')}`);
  }
  const profile = reopenProfile ?? `${profilePrefix}-${Date.now()}`;
  const profileDir = join(appData, profile);
  if (reopenProfile) {
    if (!existsSync(join(profileDir, 'chord.db'))) {
      throw new Error(`No profile to reopen: ${join(profileDir, 'chord.db')}`);
    }
  } else {
    mkdirSync(profileDir, { recursive: true });
    for (const entry of SEED_ENTRIES) {
      const from = join(seedDir, entry);
      if (existsSync(from)) cpSync(from, join(profileDir, entry), { recursive: true });
    }
  }

  const app = await electron.launch({
    executablePath: target.executablePath,
    args: target.args,
    cwd: ROOT,
    timeout: 90_000,
    // CHORD_E2E_VIDEO=1: a video of this launch lands in screenshots/e2e/video and
    // the run record lists it (the harness proof slot, .command-center/.workflows/harness.json).
    ...(process.env.CHORD_E2E_VIDEO
      ? { recordVideo: { dir: E2E_VIDEO_DIR, size: { width: 1280, height: 800 } } }
      : {}),
    env: {
      ...process.env,
      CHORD_PROFILE: profile,
      CHORD_DISABLE_PTY: '1',
      ...env,
    },
  });

  // Main-process output, kept whole so a probe can read what main logged:
  // info and debug go to stdout, warnings and errors to stderr.
  let stdout = '';
  app.process().stdout?.on('data', (chunk) => {
    stdout += chunk.toString();
  });
  let stderr = '';
  app.process().stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  // What the app did that a check would not expect, with times, so a failure
  // like devstation-a6f ("Execution context was destroyed") can say whether
  // the main process died, the renderer crashed, or the window reloaded.
  const timeline = [];
  const note = (what) => timeline.push(`${new Date().toISOString()} ${what}`);
  app.process().on('exit', (code, signal) => note(`main process exited (${code ?? signal})`));

  const page = await app.firstWindow({ timeout: 90_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.waitForFunction(() => !!window.electronAPI, null, { timeout: 60_000 });
  page.on('crash', () => note('renderer crashed'));
  page.on('close', () => note('window closed'));
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) note(`window navigated to ${frame.url()}`);
  });

  const rpc = (channel, ...args) =>
    page.evaluate(([c, a]) => window.electronAPI.invoke(c, ...a), [channel, args]);

  let session;
  try {
    session = await assertSeedSignedIn({ rpc }, seedProfile);
  } catch (error) {
    await app.close();
    rmSync(profileDir, { recursive: true, force: true });
    throw error;
  }

  return {
    app,
    page,
    rpc,
    executablePath: target.executablePath,
    profileDir,
    /** The seed's signed-in session (`account.getSession`), checked live at launch. */
    session,
    readStdout: () => stdout,
    readStderr: () => stderr,
    /** Main exits, renderer crashes and reloads since launch, oldest first. */
    readTimeline: () => [...timeline],
    /** `keepProfile`: leave the profile for a `reopenProfile` launch. */
    close: async ({ keepProfile = false } = {}) => {
      await app.close();
      // A refresh during the run spent the seed's token (seed-session.mjs).
      if (returnSessionToSeed(profileDir, seedDir)) {
        console.log(`returned the run's refreshed sign-in to seed profile ${seedProfile}`);
      }
      if (!keepProfile) rmSync(profileDir, { recursive: true, force: true });
      // Scratch lanes a suite already removed; the rest go at the next launch.
      reportPrunedTrust(pruneScratchCodexTrust());
    },
  };
}

/** The e2e scratch folders' Codex trust taken out of the user's config (devstation-xvgp). */
function reportPrunedTrust(removed) {
  if (removed.length === 0) return;
  console.log(`removed Codex trust for ${removed.length} gone scratch folder(s) from config.toml`);
}
