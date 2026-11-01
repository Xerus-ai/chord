import type { FileWatchEvent } from '@shared/fs';
import type { FileEntry, FileListResult, FileWatcher } from '../types';

export function createSshWatcher(
  listFn: (path: string, options?: { includeHidden?: boolean }) => Promise<FileListResult>,
  callback: (events: FileWatchEvent[]) => void,
  options: { debounceMs?: number } = {}
): FileWatcher {
  const interval = options.debounceMs ?? 4000;
  let watched: string[] = [];
  const snapshots = new Map<string, Map<string, FileEntry>>();

  const poll = async () => {
    for (const dirPath of watched) {
      let result: FileListResult | null = null;
      try {
        result = await listFn(dirPath, { includeHidden: true });
      } catch {
        continue;
      }

      const currMap = new Map(result.entries.map((e) => [e.path, e]));
      const prevMap = snapshots.get(dirPath);
      snapshots.set(dirPath, currMap);

      if (!prevMap) continue;

      const evts: FileWatchEvent[] = [];
      for (const [p, e] of currMap) {
        if (!prevMap.has(p))
          evts.push({
            type: 'create',
            entryType: e.type === 'dir' ? 'directory' : 'file',
            path: p,
          });
      }
      for (const [p, e] of prevMap) {
        if (!currMap.has(p))
          evts.push({
            type: 'delete',
            entryType: e.type === 'dir' ? 'directory' : 'file',
            path: p,
          });
      }
      if (evts.length) callback(evts);
    }
  };

  const timer = setInterval(() => {
    void poll();
  }, interval);

  return {
    update(paths: string[]) {
      watched = paths;
      for (const p of snapshots.keys()) {
        if (!paths.includes(p)) snapshots.delete(p);
      }
    },
    close() {
      clearInterval(timer);
    },
  };
}
