/**
 * Removes the Codex folder trust e2e runs leave in the user's own Codex config
 * (devstation-xvgp). Chord trusts each lane it opens a Codex terminal in
 * (`codex-folder-trust.ts`), and Codex trusts folders it runs in, so every
 * run's scratch lanes stayed as `[projects."<path>"]` tables long after the
 * folders were gone (34 of 44 projects in one config on 2026-10-07).
 *
 * Only tables for folders inside the OS temp folder that no longer exist are
 * removed. The edit is on the text, so comments and everything else stay as
 * written; it is written only when the result parses to the same config less
 * those projects, and the file has not changed since it was read.
 * `~/.claude.json` is left alone: Claude Code rewrites it while it runs.
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join, resolve, sep } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { parse } from 'smol-toml';

const PROJECT_HEADER = /^\[projects\.(?:"((?:[^"\\]|\\.)*)"|'([^']*)')\]\s*$/;
/** The Win32 long-path prefix Codex writes some keys with: `\\?\C:\…`. */
const LONG_PATH_PREFIX = '\\\\?\\';

/**
 * @param {{ configPath?: string, tempRoot?: string }} [options]
 * @returns {string[]} the project keys removed
 */
export function pruneScratchCodexTrust({
  configPath = join(process.env.CODEX_HOME ?? join(homedir(), '.codex'), 'config.toml'),
  tempRoot = tmpdir(),
} = {}) {
  if (!existsSync(configPath)) return [];
  const text = readFileSync(configPath, 'utf8');
  const before = parseConfig(text, configPath);
  const eol = text.includes('\r\n') ? '\r\n' : '\n';

  // Each table header owns the lines up to the next header.
  const kept = [];
  const removed = [];
  let dropping = false;
  for (const line of text.split(eol)) {
    if (line.startsWith('[')) {
      const key = readProjectKey(line);
      dropping = key !== null && isGoneScratchFolder(key, tempRoot);
      if (dropping) removed.push(key);
    }
    if (!dropping) kept.push(line);
  }
  if (removed.length === 0) return [];

  let next = kept.join(eol);
  if (text.endsWith(eol) && !next.endsWith(eol)) next += eol;
  assertOnlyProjectsRemoved(before, parseConfig(next, configPath), removed, configPath);

  if (readFileSync(configPath, 'utf8') !== text) {
    throw new Error(`${configPath} changed while its scratch trust was pruned; nothing removed`);
  }
  const temp = `${configPath}.${process.pid}.tmp`;
  writeFileSync(temp, next);
  renameSync(temp, configPath);
  return removed;
}

function parseConfig(text, configPath) {
  try {
    return parse(text);
  } catch (error) {
    throw new Error(`Codex's ${configPath} is not valid TOML: ${String(error)}`);
  }
}

/** The path a `[projects."…"]` / `[projects.'…']` header names, or null for any other table. */
function readProjectKey(line) {
  const match = PROJECT_HEADER.exec(line);
  if (!match) return null;
  return match[1] !== undefined ? JSON.parse(`"${match[1]}"`) : match[2];
}

function isGoneScratchFolder(key, tempRoot) {
  const folder = key.startsWith(LONG_PATH_PREFIX) ? key.slice(LONG_PATH_PREFIX.length) : key;
  const root = `${resolve(tempRoot).toLowerCase()}${sep}`;
  return resolve(folder).toLowerCase().startsWith(root) && !existsSync(folder);
}

/**
 * `before` is the parse of the file as read, used for nothing else, so it becomes the expected
 * config in place: smol-toml builds null-prototype tables, which a structuredClone copy would not
 * keep, and isDeepStrictEqual compares prototypes.
 */
function assertOnlyProjectsRemoved(before, after, removed, configPath) {
  const expected = before;
  for (const key of removed) delete expected.projects[key];
  if (!isDeepStrictEqual(after, expected)) {
    throw new Error(
      `Pruning ${configPath} would change more than its scratch projects; nothing removed`
    );
  }
}
