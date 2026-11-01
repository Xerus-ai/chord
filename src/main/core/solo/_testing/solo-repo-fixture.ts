import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { expect } from 'vitest';
import { GIT_EXECUTABLE } from '@main/core/utils/exec';

/**
 * A repository whose root checkout is on `main` and a lane (linked worktree)
 * on `feature`, built with the machine's real git config. On Windows that
 * config usually sets `core.autocrlf=true`, so the root holds files whose
 * bytes differ from what git would write for them (LF text that git checks
 * out as CRLF, CRLF text it stores as LF): the case a byte-identical release
 * has to survive.
 */
export interface SoloRepo {
  dir: string;
  root: string;
  lane: string;
}

export function git(cwd: string, ...args: string[]): string {
  return execFileSync(GIT_EXECUTABLE, args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function writeFile(dir: string, file: string, content: string): void {
  fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
  fs.writeFileSync(path.join(dir, file), content);
}

export function removeFile(dir: string, file: string): void {
  fs.rmSync(path.join(dir, file));
}

export function readBytes(dir: string, file: string): Buffer {
  return fs.readFileSync(path.join(dir, file));
}

export function createSoloRepo(): SoloRepo {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'chord-solo-'));
  const root = path.join(dir, 'root');
  fs.mkdirSync(root);
  git(root, 'init', '-b', 'main');
  git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'config', 'user.name', 'Chord Test');
  // Snapshot commits must not depend on the host's signing setup.
  git(root, 'config', 'commit.gpgsign', 'false');

  writeFile(root, '.gitignore', 'dist/\n*.log\nconfig.local\n');
  writeFile(root, 'README.md', '# app\n\nRoot readme.\n');
  writeFile(root, 'src/app.ts', 'export const a = 1;\nexport const b = 2;\n');
  writeFile(root, 'src/util.ts', 'export function util() {\n  return 1;\n}\n');
  writeFile(root, 'docs/guide.md', 'Guide\n');
  writeFile(root, 'docs/other.md', 'Other\nnotes\n');
  writeFile(root, 'windows.txt', 'crlf line one\r\ncrlf line two\r\n');
  git(root, 'add', '-A');
  git(root, 'commit', '-m', 'base');

  // Ignored files a real root carries: build output, logs, local config.
  writeFile(root, 'dist/bundle.js', 'bundle();\n');
  writeFile(root, 'server.log', 'started\n');
  writeFile(root, 'config.local', 'ROOT_SECRET=1\n');

  const lane = addLane({ dir, root, lane: '' }, 'lane', 'feature');
  return { dir, root, lane };
}

/** Adds a linked worktree of the root on a new branch; returns its path. */
export function addLane(repo: SoloRepo, name: string, branch: string): string {
  const lane = path.join(repo.dir, name);
  git(repo.root, 'worktree', 'add', lane, '-b', branch);
  return lane;
}

/**
 * Gives the lane a commit of its own (an edit, an added file, a deleted
 * file) and uncommitted work on top (an edit, an untracked file in a new
 * folder, a deleted file).
 */
export function prepareLaneWork(lane: string): void {
  writeFile(lane, 'src/app.ts', 'export const a = 10;\nexport const b = 2;\n');
  writeFile(lane, 'src/feature.ts', 'export const feature = true;\n');
  removeFile(lane, 'src/util.ts');
  git(lane, 'add', '-A');
  git(lane, 'commit', '-m', 'lane work');

  writeFile(lane, 'README.md', '# app\n\nLane readme.\n');
  writeFile(lane, 'notes/todo.md', '- ship it\n');
  removeFile(lane, 'docs/guide.md');
}

/** The lane stops ignoring `config.local` and commits its own copy of it. */
export function trackConfigLocalInLane(lane: string): void {
  writeFile(lane, '.gitignore', 'dist/\n*.log\n');
  writeFile(lane, 'config.local', 'LANE_SETTING=1\n');
  git(lane, 'add', '-A');
  git(lane, 'commit', '-m', 'track config.local');
}

export function removeSoloRepo(repo: SoloRepo): void {
  fs.rmSync(repo.dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
}

/** sha256 of every file under `dir` except the top-level `.git`, ignored files included. */
export function hashWorkingFiles(dir: string): Record<string, string> {
  const hashes: Record<string, string> = {};
  const walk = (relDir: string): void => {
    for (const entry of fs.readdirSync(path.join(dir, relDir), { withFileTypes: true })) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (rel === '.git') continue;
      if (entry.isDirectory()) walk(rel);
      else hashes[rel] = createHash('sha256').update(readBytes(dir, rel)).digest('hex');
    }
  };
  walk('');
  return hashes;
}

export function headOf(repo: string): string {
  return git(repo, 'rev-parse', 'HEAD').trim();
}

/** The checked-out branch, or `HEAD` when detached. */
export function branchOf(repo: string): string {
  return git(repo, 'rev-parse', '--abbrev-ref', 'HEAD').trim();
}

export function statusOf(repo: string): string {
  return git(repo, 'status', '--porcelain', '--no-renames', '--untracked-files=all');
}

export function stagedFilesOf(repo: string): string {
  return git(repo, 'diff', '--cached', '--name-only').trim();
}

export function gitDirOf(repo: string): string {
  return git(repo, 'rev-parse', '--absolute-git-dir').trim();
}

export function soloRecordFile(root: string): string {
  return path.join(gitDirOf(root), 'chord-solo.json');
}

export function soloBackupDir(root: string): string {
  return path.join(gitDirOf(root), 'chord-solo-backup');
}

export function soloRefsOf(repo: string): string[] {
  return git(repo, 'for-each-ref', '--format=%(refname)', 'refs/chord/solo/')
    .split('\n')
    .filter(Boolean);
}

/**
 * The checkout's index entries: mode, blob, stage and path of every file.
 * Not the file's bytes: any `git status` refreshes the stat cache of entries
 * written within the same second as their file (Linux), so the bytes change
 * under a reader that touched nothing.
 */
export function indexEntriesOf(repo: string): string {
  return git(repo, 'ls-files', '--stage');
}

/**
 * Non-ignored files present on disk. Compared through `git hash-object`,
 * which applies the repo's line-ending conversion: the root holds the lane's
 * content as git writes it, not necessarily the lane's exact bytes.
 */
export function listWorkingFiles(repo: string): string[] {
  return git(repo, '-c', 'core.quotepath=false', 'ls-files', '-co', '--exclude-standard')
    .split('\n')
    .filter(Boolean)
    .filter((file) => fs.existsSync(path.join(repo, file)))
    .sort();
}

export function blobOf(repo: string, file: string): string {
  return git(repo, 'hash-object', '--', file).trim();
}

/** The root's tracked-and-untracked content equals the lane's, file by file. */
export function expectRootMatchesLane(root: string, lane: string): void {
  const laneFiles = listWorkingFiles(lane);
  expect(listWorkingFiles(root)).toEqual(laneFiles);
  for (const file of laneFiles) {
    expect(`${file} ${blobOf(root, file)}`).toBe(`${file} ${blobOf(lane, file)}`);
  }
}
