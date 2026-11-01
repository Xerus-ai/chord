import { statSync } from 'node:fs';
import { relative } from 'node:path';
import parcelWatcher from '@parcel/watcher';
import type { FileWatchEvent } from '@shared/fs';
import type { FileWatcher } from '../types';

const WATCH_IGNORED_NAMES = [
  '.svn',
  '.hg',
  '.git',
  'node_modules',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '__pycache__',
  '.pytest_cache',
  'venv',
  '.venv',
  'target',
  '.terraform',
  '.serverless',
  'worktrees',
  '.chord',
  '.conductor',
  '.cursor',
  '.claude',
  '.amp',
  '.codex',
  '.aider',
  '.continue',
  '.cody',
  '.windsurf',
];

const WATCH_IGNORE_GLOBS = WATCH_IGNORED_NAMES.map((n) => `**/${n}/**`);

export function createLocalWatcher(
  projectPath: string,
  callback: (events: FileWatchEvent[]) => void,
  options: { debounceMs?: number } = {}
): FileWatcher {
  const stabilityMs = options.debounceMs ?? 200;
  let pending: FileWatchEvent[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let resolvedSub: parcelWatcher.AsyncSubscription | null = null;
  let closed = false;

  const flush = () => {
    if (pending.length) {
      callback(pending);
      pending = [];
    }
  };

  const enqueue = (evt: FileWatchEvent) => {
    pending.push(evt);
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = setTimeout(flush, stabilityMs);
  };

  const toRel = (absPath: string) => relative(projectPath, absPath).replace(/\\/g, '/');

  void parcelWatcher
    .subscribe(
      projectPath,
      (err, events) => {
        if (err) return;
        for (const e of events) {
          const rel = toRel(e.path);
          if (rel.startsWith('..')) continue;

          let entryType: 'file' | 'directory' = 'file';
          if (e.type !== 'delete') {
            try {
              entryType = statSync(e.path).isDirectory() ? 'directory' : 'file';
            } catch {}
          }
          const type = e.type === 'update' ? ('modify' as const) : e.type;
          enqueue({ type, entryType, path: rel });
        }
      },
      { ignore: WATCH_IGNORE_GLOBS }
    )
    .then((sub) => {
      if (closed) {
        void sub.unsubscribe();
      } else {
        resolvedSub = sub;
      }
    })
    .catch(() => {});

  return {
    update(_paths: string[]) {},
    close() {
      closed = true;
      if (flushTimer) clearTimeout(flushTimer);
      if (resolvedSub) void resolvedSub.unsubscribe();
    },
  };
}
