import { toast } from 'sonner';
import { create } from 'zustand';
import { menuCheckForUpdatesChannel } from '@shared/events/appEvents';
import {
  updateAvailableEvent,
  updateCheckingEvent,
  updateDownloadedEvent,
  updateDownloadingEvent,
  updateErrorEvent,
  updateInstallingEvent,
  updateNotAvailableEvent,
  updateProgressEvent,
} from '@shared/events/updateEvents';
import { events, rpc } from '@renderer/lib/ipc';
import { log } from '@renderer/utils/logger';

const LAST_NOTIFIED_KEY = 'chord:update:lastNotified';
const SNOOZE_HOURS = 6;

type DownloadProgress = {
  percent?: number;
  transferred?: number;
  total?: number;
  bytesPerSecond?: number;
};

export type UpdateState =
  | { status: 'idle' }
  | { status: 'checking' }
  | { status: 'available'; info?: { version: string } }
  | { status: 'not-available' }
  | { status: 'downloading'; progress?: DownloadProgress }
  | { status: 'downloaded' }
  | { status: 'installing' }
  | { status: 'error'; message: string };

interface UpdateStoreState {
  state: UpdateState;
  currentVersion: string;
  availableVersion: string | undefined;
  start: () => void;
  check: () => Promise<void>;
  download: () => Promise<void>;
  install: () => Promise<void>;
  openLatest: () => Promise<void>;
}

function shouldNotify(version: string): boolean {
  try {
    const raw = localStorage.getItem(LAST_NOTIFIED_KEY);
    if (!raw) return true;
    const parsed = JSON.parse(raw) as { version?: string; at?: number };
    if (parsed.version === version) {
      const at = parsed.at ?? 0;
      if (Date.now() - at < Math.max(1, SNOOZE_HOURS) * 3_600_000) return false;
    }
    return true;
  } catch {
    return true;
  }
}

function rememberNotified(version: string): void {
  try {
    localStorage.setItem(LAST_NOTIFIED_KEY, JSON.stringify({ version, at: Date.now() }));
  } catch {
    // localStorage may be unavailable
  }
}

function maybeToastAvailable(version: string): void {
  if (!shouldNotify(version)) return;
  toast('Update Available', {
    description: `Version ${version} is ready. Go to Settings to upgrade.`,
  });
  rememberNotified(version);
}

export const useUpdateStore = create<UpdateStoreState>()((set) => ({
  state: { status: 'idle' } as UpdateState,
  currentVersion: '',
  availableVersion: undefined,

  start: () => {
    void rpc.app.getAppVersion().then((v) => {
      set({ currentVersion: v });
    });

    events.on(updateCheckingEvent, () => {
      set({ state: { status: 'checking' } });
    });

    events.on(updateAvailableEvent, (d) => {
      set({
        availableVersion: d.version,
        state: { status: 'available', info: { version: d.version } },
      });
      maybeToastAvailable(d.version);
    });

    events.on(updateNotAvailableEvent, () => {
      set({ state: { status: 'not-available' } });
    });

    events.on(updateDownloadingEvent, () => {
      set({ state: { status: 'downloading', progress: { percent: 0 } } });
    });

    events.on(updateProgressEvent, (d) => {
      set({
        state: {
          status: 'downloading',
          progress: {
            percent: d.percent,
            transferred: d.transferred,
            total: d.total,
            bytesPerSecond: d.bytesPerSecond,
          },
        },
      });
    });

    events.on(updateDownloadedEvent, () => {
      set({ state: { status: 'downloaded' } });
    });

    events.on(updateInstallingEvent, () => {
      set({ state: { status: 'installing' } });
    });

    events.on(updateErrorEvent, (d) => {
      set({ state: { status: 'error', message: d.message } });
    });

    // The menu item is a user action — route it through `check` so a failure
    // lands in update state instead of vanishing.
    events.on(menuCheckForUpdatesChannel, () => {
      void useUpdateStore.getState().check();
    });

    // Boot-time check is background work nobody asked for: log it, don't put
    // the Settings card into an error state before the user has looked at it.
    rpc.update.check().catch((error: unknown) => {
      log.warn('Startup update check failed:', error);
    });
  },

  check: async () => {
    set({ state: { status: 'checking' } });
    try {
      const res = await rpc.update.check();
      if (!res) {
        set({ state: { status: 'error', message: 'Update API unavailable' } });
        return;
      }
      if (!res.success) {
        set({ state: { status: 'error', message: res.error ?? 'Failed to check for updates' } });
      } else if (res.result === null) {
        set({ state: { status: 'idle' } });
      }
    } catch {
      set({ state: { status: 'error', message: 'Failed to check for updates' } });
    }
  },

  download: async () => {
    try {
      const res = await rpc.update.download();
      if (!res) {
        set({ state: { status: 'error', message: 'Update API unavailable' } });
        return;
      }
      if (!res.success) {
        set({ state: { status: 'error', message: res.error ?? 'Failed to download update' } });
      }
    } catch {
      set({ state: { status: 'error', message: 'Failed to download update' } });
    }
  },

  install: async () => {
    set({ state: { status: 'installing' } });
    try {
      const res = await rpc.update.quitAndInstall();
      if (!res) {
        set({ state: { status: 'error', message: 'Update API unavailable' } });
        return;
      }
      if (!res.success) {
        set({ state: { status: 'error', message: res.error ?? 'Failed to install update' } });
      }
    } catch {
      set({ state: { status: 'error', message: 'Failed to install update' } });
    }
  },

  openLatest: async () => {
    try {
      await rpc.update.openLatest();
    } catch {
      // openLatest quits the app — errors are best-effort
    }
  },
}));

export function getHasUpdate(): boolean {
  const { status } = useUpdateStore.getState().state;
  return status === 'available' || status === 'downloading' || status === 'downloaded';
}

export function getProgressLabel(): string {
  const state = useUpdateStore.getState().state;
  if (state.status !== 'downloading') return '';
  const p = state.progress?.percent ?? 0;
  return `${p.toFixed(0)}%`;
}
