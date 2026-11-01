import { existsSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import * as toml from 'smol-toml';
import type { IExecutionContext } from '@main/core/execution-context/types';
import { makeCodexNotifyCommand } from './agent-notify-command';
import {
  buildClaudeHookEntry,
  CHORD_GITIGNORE_ENTRIES,
  CLAUDE_HOOK_EVENTS,
  CLAUDE_LOCAL_SETTINGS_PATH,
  CODEX_PROJECT_CONFIG_PATH,
  PI_EXTENSION_PATH,
} from './chord-hook-entries';
import { excludeFromGit } from './git-info-exclude';

/**
 * Takes back what builds before devstation-bmj/tx0 left in a checkout: Chord's
 * hook entries in `.claude/settings.local.json` (which would now fire next to
 * the launch-flag hooks), its notify in `.codex/config.toml`, and the lines it
 * appended to `.gitignore`. Only what is exactly Chord's goes — an entry equal
 * to the one Chord wrote, a file holding nothing else and tracked by no one, a
 * `.gitignore` whose unstaged change is nothing but Chord's lines.
 */
export async function removeOldHookConfig(opts: {
  cwd: string;
  git: IExecutionContext;
  platform: NodeJS.Platform;
}): Promise<void> {
  await removeOldClaudeHooks(opts.cwd, opts.git);
  await removeOldCodexNotify(opts.cwd, opts.git, opts.platform);
  // Pi still loads its extension from the checkout: hide it the new way
  // before the old .gitignore line goes.
  if (existsSync(join(opts.cwd, PI_EXTENSION_PATH))) {
    await excludeFromGit(opts.git, opts.cwd, PI_EXTENSION_PATH);
  }
  await removeOldGitIgnoreLines(opts.cwd, opts.git);
}

/** Markers every command Chord ever wrote carries; a file without one holds nothing of Chord's. */
const CHORD_COMMAND_MARKERS = ['CHORD_HOOK_PORT', 'chord-codex-notify'];

async function readChordCandidate(path: string): Promise<string | null> {
  if (!existsSync(path)) return null;
  const text = await readFile(path, 'utf-8');
  return CHORD_COMMAND_MARKERS.some((marker) => text.includes(marker)) ? text : null;
}

async function isTracked(git: IExecutionContext, checkoutPath: string): Promise<boolean> {
  const { stdout } = await git.exec('git', ['ls-files', '--', checkoutPath]);
  return stdout.trim().length > 0;
}

/** Writes what is left, or deletes the file when Chord's part was all of it and git doesn't track it. */
async function writeRemainder(
  git: IExecutionContext,
  cwd: string,
  checkoutPath: string,
  remainder: Record<string, unknown>,
  serialize: (value: Record<string, unknown>) => string
): Promise<void> {
  const path = join(cwd, checkoutPath);
  if (Object.keys(remainder).length === 0 && !(await isTracked(git, checkoutPath))) {
    await rm(path);
    return;
  }
  await writeFile(path, serialize(remainder));
}

async function removeOldClaudeHooks(cwd: string, git: IExecutionContext): Promise<void> {
  const text = await readChordCandidate(join(cwd, CLAUDE_LOCAL_SETTINGS_PATH));
  if (text === null) return;
  const config = JSON.parse(text) as Record<string, unknown>;
  const hooks = config.hooks;
  if (typeof hooks !== 'object' || hooks === null || Array.isArray(hooks)) return;

  const keptHooks: Record<string, unknown> = { ...hooks };
  let removed = false;
  for (const { eventType, hookKey } of CLAUDE_HOOK_EVENTS) {
    const entries = keptHooks[hookKey];
    if (!Array.isArray(entries)) continue;
    const chordEntry = buildClaudeHookEntry(eventType);
    const kept = entries.filter((entry) => !isDeepStrictEqual(entry, chordEntry));
    if (kept.length === entries.length) continue;
    removed = true;
    if (kept.length === 0) delete keptHooks[hookKey];
    else keptHooks[hookKey] = kept;
  }
  if (!removed) return;

  const remainder: Record<string, unknown> = { ...config, hooks: keptHooks };
  if (Object.keys(keptHooks).length === 0) delete remainder.hooks;
  await writeRemainder(
    git,
    cwd,
    CLAUDE_LOCAL_SETTINGS_PATH,
    remainder,
    (value) => JSON.stringify(value, null, 2) + '\n'
  );
}

async function removeOldCodexNotify(
  cwd: string,
  git: IExecutionContext,
  platform: NodeJS.Platform
): Promise<void> {
  const text = await readChordCandidate(join(cwd, CODEX_PROJECT_CONFIG_PATH));
  if (text === null) return;
  const config: Record<string, unknown> = toml.parse(text);
  if (!isDeepStrictEqual(config.notify, makeCodexNotifyCommand({ platform }))) return;

  const remainder = { ...config };
  delete remainder.notify;
  await writeRemainder(git, cwd, CODEX_PROJECT_CONFIG_PATH, remainder, (value) =>
    toml.stringify(value)
  );
}

/** Lines compared the way the old writer could have changed them: trailing space and blank tail ignored. */
function normalizeLines(text: string): string[] {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  return lines;
}

async function removeOldGitIgnoreLines(cwd: string, git: IExecutionContext): Promise<void> {
  const path = join(cwd, '.gitignore');
  if (!existsSync(path)) return;
  const working = await readFile(path, 'utf-8');
  const isChordLine = (line: string) => CHORD_GITIGNORE_ENTRIES.includes(line.trim());
  const workingLines = normalizeLines(working);
  if (!workingLines.some(isChordLine)) return;
  const withoutChord = workingLines.filter((line) => !isChordLine(line));

  if (!(await isTracked(git, '.gitignore'))) {
    if (withoutChord.every((line) => line.trim() === '')) await rm(path);
    return;
  }
  // The staged copy is what the unstaged change is measured against; restore
  // it only when Chord's lines are the whole of that change, in the line
  // endings the file already had (a `git checkout` would apply autocrlf).
  const { stdout: staged } = await git.exec('git', ['show', ':.gitignore']);
  if (isDeepStrictEqual(withoutChord, normalizeLines(staged))) {
    const eol = working.includes('\r\n') ? '\r\n' : '\n';
    await writeFile(path, staged.replace(/\r?\n/g, eol));
  }
}
