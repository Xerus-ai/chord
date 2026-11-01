/**
 * A runner that is killed mid-suite (a timeout, a stopped task) never reaches
 * its `close()`: the app it launched keeps running with nothing reading its
 * output, and its throw-away profile stays in APPDATA. On 2026-10-01 one such
 * app sat for 45 minutes and then showed the main-process crash dialog
 * (EPIPE on its dead stdout pipe).
 *
 * Before a launch, every app the harness started whose launcher has since
 * died is ended, process tree included, and its profile deleted. "The harness
 * started" is the launched executable plus Playwright's `--remote-debugging-port=0`;
 * "its launcher has died" is a parent pid that is gone, or that now names a
 * newer process (Windows reuses pids). A suite still running keeps its
 * parent, so it is never touched.
 */
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';
import { basename, dirname, resolve } from 'node:path';

/** @returns {{ pid: number, ppid: number, exe: string, cmd: string, created: number }[]} */
function listProcesses() {
  // UTF-8 out: PowerShell writes a pipe in the console's OEM code page, whose
  // best-fit mapping turns symbols in a command line ("→", "•") into raw
  // control bytes that JSON.parse rejects (devstation-gabe).
  const script =
    '[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; ' +
    'Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ ' +
    'pid = $_.ProcessId; ppid = $_.ParentProcessId; exe = $_.ExecutablePath; ' +
    'cmd = $_.CommandLine; created = $_.CreationDate.ToFileTimeUtc() } } | ConvertTo-Json -Compress';
  const raw = execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-Command', script], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return JSON.parse(raw).map((p) => ({ ...p, exe: p.exe ?? '', cmd: p.cmd ?? '' }));
}

function userDataDirOf(cmd) {
  const match = /--user-data-dir="?([^"]+?)"?(?:\s--|$)/.exec(cmd);
  return match ? match[1] : null;
}

/** Only a throw-away profile (`launchSeededApp`'s `<prefix>-<Date.now()>` in APPDATA), never a seed. */
function isThrowAwayProfile(dir) {
  const appData = process.env.APPDATA;
  if (!appData) throw new Error('APPDATA is not set');
  return (
    resolve(dirname(dir)).toLowerCase() === resolve(appData).toLowerCase() &&
    /-\d{13}$/.test(basename(dir))
  );
}

/**
 * Whether the process that launched `p` is still running. Playwright starts
 * the app through `cmd.exe` on Windows, so a shell parent is looked through to
 * its own. A parent created after its child is a reused pid, not the launcher.
 */
function hasLiveLauncher(p, byPid) {
  let child = p;
  for (;;) {
    const parent = byPid.get(child.ppid);
    if (!parent || parent.created > child.created) return false;
    if (!/\cmd\.exe$/i.test(parent.exe)) return true;
    child = parent;
  }
}

function descendantsOf(root, processes) {
  const tree = [root];
  for (let i = 0; i < tree.length; i++) {
    for (const p of processes)
      if (p.ppid === tree[i].pid && p.created >= tree[i].created) tree.push(p);
  }
  return tree;
}

/**
 * taskkill /F returns before Windows has closed the killed processes' handles,
 * and Node reports a process gone once its exit code is set, which is earlier
 * still; the profile stays locked (EPERM/EBUSY) until the handles close.
 */
async function removeWhenReleased(dir, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      rmSync(dir, { recursive: true, force: true });
      return;
    } catch (error) {
      if ((error.code !== 'EPERM' && error.code !== 'EBUSY') || Date.now() > deadline) throw error;
      await new Promise((resolveWait) => setTimeout(resolveWait, 250));
    }
  }
}

/**
 * @param {string} executablePath the app executable the harness launches
 * @returns {Promise<{ pid: number, profileDir: string | null }[]>} what was reaped; `profileDir`
 *   is the profile deleted with it, null when it had none to delete
 */
export async function reapOrphanedApps(executablePath) {
  const target = resolve(executablePath).toLowerCase();
  const processes = listProcesses();
  const byPid = new Map(processes.map((p) => [p.pid, p]));

  const orphans = processes.filter(
    (p) =>
      p.exe.toLowerCase() === target &&
      !p.cmd.includes('--type=') &&
      p.cmd.includes('--remote-debugging-port=0') &&
      !hasLiveLauncher(p, byPid)
  );

  const reaped = [];
  for (const orphan of orphans) {
    const tree = descendantsOf(orphan, processes);
    const profileDir = tree.map((p) => userDataDirOf(p.cmd)).find(Boolean) ?? null;
    execFileSync('taskkill', ['/PID', String(orphan.pid), '/T', '/F'], { stdio: 'ignore' });
    if (profileDir && isThrowAwayProfile(profileDir)) {
      await removeWhenReleased(profileDir, 20_000);
      reaped.push({ pid: orphan.pid, profileDir });
    } else {
      reaped.push({ pid: orphan.pid, profileDir: null });
    }
  }
  return reaped;
}
