import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * Translation of paths an agent reports back into real Windows paths.
 *
 * Agent CLIs run their shell tool under Git Bash on Windows, and MSYS renders
 * a Windows directory in POSIX form: `C:\repo` prints as `/c/repo`, and
 * anything under the Windows temp directory prints as `/tmp/...` because MSYS
 * mounts `%TEMP%` at `/tmp`. A model that runs `pwd` copies that string
 * straight into the native file tools, where Node resolves the leading slash
 * against the *current drive* — a write meant for `%TEMP%\repo\notes.md`
 * lands in `C:\tmp\repo\notes.md`, and the path Chord records for the
 * artifact and the file-changed strip points at a file that is not in the
 * repo. Everything an agent reports goes through here before Chord executes,
 * stores, or renders it.
 */
export interface AgentPathEnvironment {
  platform: NodeJS.Platform;
  /** The Windows temp directory, which MSYS mounts at `/tmp`. */
  tempDir: string;
}

const WINDOWS_ROOT = /^(?:[A-Za-z]:[\\/]|[\\/]{2})/;
const DRIVE_LETTER = /^[A-Za-z]$/;

function currentEnvironment(): AgentPathEnvironment {
  return { platform: process.platform, tempDir: tmpdir() };
}

function stripTrailingSeparators(value: string): string {
  return value.replace(/[\\/]+$/, '');
}

function joinFromDriveRoot(letter: string, segments: string[]): string {
  return path.win32.join(`${letter.toUpperCase()}:\\`, ...segments);
}

/**
 * Every POSIX form Git Bash could print for one Windows directory, most
 * specific first (`/tmp` shadows the drive form for paths under `%TEMP%`).
 */
function msysRenderings(windowsDir: string, tempDir: string): string[] {
  const dir = stripTrailingSeparators(path.win32.normalize(windowsDir));
  const temp = stripTrailingSeparators(path.win32.normalize(tempDir));
  const renderings: string[] = [];

  const lowerDir = dir.toLowerCase();
  const lowerTemp = temp.toLowerCase();
  if (temp && (lowerDir === lowerTemp || lowerDir.startsWith(`${lowerTemp}\\`))) {
    renderings.push(`/tmp${dir.slice(temp.length).replace(/\\/g, '/')}`);
  }

  const drive = /^([A-Za-z]):[\\/](.*)$/.exec(dir);
  if (drive) {
    const letter = drive[1].toLowerCase();
    const rest = drive[2].replace(/\\/g, '/');
    const suffix = rest ? `/${rest}` : '';
    renderings.push(`/${letter}${suffix}`);
    renderings.push(`/cygdrive/${letter}${suffix}`);
  }

  return renderings;
}

/**
 * Exact round-trip: the session's own cwd rendered the way MSYS would print
 * it. Matching on that prefix beats the mount table because it survives temp
 * directories that differ by 8.3 shortening or casing.
 */
function rebaseOnCwd(reported: string, cwd: string, tempDir: string): string | null {
  const lower = reported.toLowerCase();
  for (const rendering of msysRenderings(cwd, tempDir)) {
    const prefix = rendering.toLowerCase();
    if (lower === prefix) return path.win32.normalize(cwd);
    if (lower.startsWith(`${prefix}/`)) {
      return path.win32.join(cwd, reported.slice(rendering.length + 1));
    }
  }
  return null;
}

/** The MSYS mount table: drive mounts plus `%TEMP%` at `/tmp`. */
function fromMsysMount(reported: string, tempDir: string): string | null {
  const segments = reported.split('/').filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;

  if (segments[0] === 'cygdrive' && DRIVE_LETTER.test(segments[1] ?? '')) {
    return joinFromDriveRoot(segments[1], segments.slice(2));
  }
  if (DRIVE_LETTER.test(segments[0])) {
    return joinFromDriveRoot(segments[0], segments.slice(1));
  }
  if (segments[0] === 'tmp') {
    return path.win32.join(tempDir, ...segments.slice(1));
  }
  return null;
}

/**
 * Resolves a path as reported by an agent into the absolute path Chord should
 * use. `cwd` is the session's workspace directory; relative paths are
 * anchored on it and it drives the round-trip translation above.
 */
export function resolveAgentReportedPath(
  reported: string,
  cwd: string | null | undefined,
  environment: AgentPathEnvironment = currentEnvironment()
): string {
  const raw = reported.trim();
  if (!raw) return reported;

  if (environment.platform !== 'win32') {
    if (path.posix.isAbsolute(raw)) return path.posix.normalize(raw);
    return cwd ? path.posix.join(cwd, raw) : raw;
  }

  if (WINDOWS_ROOT.test(raw)) return path.win32.normalize(raw);
  if (!raw.startsWith('/')) return cwd ? path.win32.join(cwd, raw) : raw;

  if (cwd) {
    const rebased = rebaseOnCwd(raw, cwd, environment.tempDir);
    if (rebased) return rebased;
  }

  const mounted = fromMsysMount(raw, environment.tempDir);
  if (mounted) return mounted;

  // An unmapped POSIX root (`/usr/share/...`): Node resolves it against the
  // drive the session runs on, so that is where the agent's own tool wrote —
  // pointing Chord anywhere else would name a file that does not exist.
  return cwd ? path.win32.resolve(cwd, raw) : path.win32.normalize(raw);
}
