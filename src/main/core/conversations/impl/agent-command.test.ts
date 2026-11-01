import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Terminal } from '@xterm/headless';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { spawnLocalPty } from '@main/core/pty/local-pty';
import { buildAgentCommand } from './agent-command';

/**
 * A Chord-launched Codex terminal opens on Codex, not on Codex's own update
 * prompt (devstation-v6v). Codex checks for a newer release at startup and,
 * when it finds one, its first screen is "Update available" with an "Update
 * now" choice that runs an installer inside the lane (agent-terminals-03).
 * Chord launches it with the check off: `check_for_update_on_startup`, a
 * top-level key of Codex's config (codex-rs `tui/src/updates.rs`).
 *
 * The installed Codex runs for real in Chord's own PTY (`spawnLocalPty`), with
 * the command Chord builds; its exit after kill means Codex is gone
 * (devstation-lvp). Its home is a temporary CODEX_HOME holding the update cache
 * (`version.json`) with a release newer than any installed one, so the prompt
 * is due without a network call, and a config with Codex's startup work off.
 * Codex shows the prompt only when it knows how it was installed;
 * `CODEX_MANAGED_BY_NPM` tells it, as npm's launcher does. What Codex shows is
 * read from the screen as drawn (`@xterm/headless`), not from its output:
 * Codex paints a composer frame before its startup screens and redraws only
 * the cells that change (devstation-rtg3).
 * The settings database is the real migrated schema in memory: the app's file
 * needs Electron's `app` for its path.
 */
vi.mock('@main/db/client', async () => {
  const { createMigratedTestDb } = await import('@main/db/_testing/migrated-test-db');
  return { db: createMigratedTestDb() };
});

const UPDATE_PROMPT = /Update available/;
/**
 * Codex's own first screen: this home has no login, so it is sign-in, which
 * Codex shows only after the update prompt would have been.
 */
const CODEX_SIGN_IN = /Sign in with ChatGPT/;
const STARTUP_TIMEOUT_MS = 20_000;
const COLS = 120;
const ROWS = 40;

const dirs: string[] = [];

function makeDir(prefix: string): string {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), prefix)));
  dirs.push(dir);
  return dir;
}

/**
 * The work Codex does in a fresh home at startup, off: installing its app-server daemon (464 MB)
 * into the home and running it from there (`daemon_auto_start`), and git-fetching the curated
 * plugin marketplace into it (`plugins`). Both hold the update prompt back for seconds, over the
 * network, and leave the home still in use after the kill (devstation-rtg3).
 */
const HOME_CONFIG = '[features]\nplugins = false\ndaemon_auto_start = false\n';

/** A CODEX_HOME whose update cache says a newer release is out, checked just now. */
function makeCodexHomeWithUpdateDue(): string {
  const home = makeDir('chord-codex-home-');
  writeFileSync(join(home, 'config.toml'), HOME_CONFIG);
  writeFileSync(
    join(home, 'version.json'),
    JSON.stringify({
      latest_version: '99.0.0',
      last_checked_at: new Date().toISOString(),
      dismissed_version: null,
    })
  );
  return home;
}

function processEnv(): Record<string, string> {
  return Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined)
  );
}

/** The terminal's visible rows, as drawn. */
function visibleText(terminal: Terminal): string {
  const buffer = terminal.buffer.active;
  const rows: string[] = [];
  for (let row = 0; row < terminal.rows; row++) {
    rows.push(buffer.getLine(buffer.viewportY + row)?.translateToString(true) ?? '');
  }
  return rows.join('\n');
}

/** Runs Codex until its screen is either the update prompt or its own first screen. */
async function firstScreenOf(command: string, args: string[]): Promise<'update-prompt' | 'codex'> {
  // `buffer`, the drawn screen, is a proposed API in the headless build.
  const terminal = new Terminal({ cols: COLS, rows: ROWS, allowProposedApi: true });
  const proc = spawnLocalPty({
    id: 'codex-first-screen',
    command,
    args,
    cols: COLS,
    rows: ROWS,
    cwd: makeDir('chord-codex-cwd-'),
    env: {
      ...processEnv(),
      CODEX_HOME: makeCodexHomeWithUpdateDue(),
      CODEX_MANAGED_BY_NPM: '1',
    },
  });
  proc.onData((data) => terminal.write(data));
  const exited = new Promise<void>((resolve) => proc.onExit(() => resolve()));
  try {
    return await vi.waitFor(
      () => {
        const screen = visibleText(terminal);
        if (UPDATE_PROMPT.test(screen)) return 'update-prompt' as const;
        if (CODEX_SIGN_IN.test(screen)) return 'codex' as const;
        throw new Error(`Codex has shown neither screen yet:\n${screen.trimEnd()}`);
      },
      { timeout: STARTUP_TIMEOUT_MS, interval: 200 }
    );
  } finally {
    // Disposed only after the exit: output still in flight is written to a live terminal.
    proc.kill();
    await exited;
    terminal.dispose();
  }
}

afterEach(async () => {
  // By the terminal's exit every Codex process is gone (devstation-lvp). What
  // held the home past the 5 s bound was Codex's startup work running from it,
  // now off. With it off, under a concurrent full `pnpm test`: 28 removals, all
  // first try, at most 43 ms; on an idle machine one EPERM was seen once, gone
  // on the next try. `rmSync`'s own retries skip EPERM on Node 24
  // (devstation-uag), so the removal is retried here until it succeeds, bounded.
  for (const dir of dirs.splice(0)) {
    await vi.waitFor(() => rmSync(dir, { recursive: true, force: true }), {
      timeout: 5_000,
      interval: 100,
    });
  }
});

/** `codex features list` as `{ name: 'true' | 'false' }`: a row is name, stage, state. */
function featureStates(list: string): Record<string, string> {
  return Object.fromEntries(
    list
      .split('\n')
      .map((line) => line.trim().split(/\s+/))
      .filter((words) => words.length >= 3)
      .map((words) => [words[0], words[words.length - 1]])
  );
}

describe('buildAgentCommand — Codex', () => {
  it('the installed Codex reads this home with its plugin sync and app-server daemon off', async () => {
    const { command } = await buildAgentCommand({ providerId: 'codex', sessionId: 'session-1' });

    const list = execFileSync(command, ['features', 'list'], {
      env: { ...processEnv(), CODEX_HOME: makeCodexHomeWithUpdateDue() },
      encoding: 'utf8',
    });

    expect(featureStates(list)).toMatchObject({ plugins: 'false', daemon_auto_start: 'false' });
  });

  it('this harness gets the installed Codex to show its update prompt', async () => {
    const { command } = await buildAgentCommand({ providerId: 'codex', sessionId: 'session-1' });

    expect(await firstScreenOf(command, [])).toBe('update-prompt');
  });

  it('a new Codex terminal opens on Codex, with no update prompt', async () => {
    const { command, args } = await buildAgentCommand({
      providerId: 'codex',
      sessionId: 'session-1',
    });

    expect(await firstScreenOf(command, args)).toBe('codex');
  });

  it('a resumed Codex terminal opens on Codex, with no update prompt', async () => {
    const { command, args } = await buildAgentCommand({
      providerId: 'codex',
      sessionId: 'session-1',
      isResuming: true,
    });

    expect(await firstScreenOf(command, args)).toBe('codex');
  });
});
