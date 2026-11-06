import type { IpcMain } from 'electron';
import { registerRPCRouter } from '@shared/ipc/rpc';

/**
 * A main process for renderer suites that run under Node (devstation-i3y5.7).
 * It installs `window.electronAPI` in the preload's shape (`preload/index.ts`:
 * invoke, eventSend, eventOn, getPathForFile), so the renderer's real RPC
 * client and event emitter (`lib/ipc.ts`) run unchanged and reach this main
 * instead of Electron's:
 *
 * - `invoke` goes through `registerRPCRouter` (`shared/ipc/rpc.ts`) — the
 *   function main registers its controllers with — over an ipcMain holding the
 *   controllers the suite serves; arguments and results cross a structured
 *   clone, as they cross Electron's IPC. A channel nothing serves rejects, as
 *   Electron's does.
 * - `send` is main's `webContents.send`: it reaches every `eventOn` listener.
 *
 * `lib/ipc.ts` reads the bridge when it loads: a suite imports this module
 * first and the code under test after it (a dynamic import).
 *
 * Lives under `_testing/` because vitest excludes `**\/_*\/**` from its test
 * globs, so the file is a helper and never a suite.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Controller = Record<string, (...args: any[]) => unknown>;
type Handler = (event: unknown, ...args: unknown[]) => unknown;

export interface TestMain {
  /** Serves these controllers on `<namespace>.<procedure>`, replacing what was served. */
  serve(router: Record<string, Controller>): void;
  /** Main sends `data` on `channel` to the renderer. */
  send(channel: string, data: unknown): void;
  /** The arguments of every invocation of `channel`, in order. */
  calls(channel: string): unknown[][];
  /** Forgets the invocations and what was served. */
  reset(): void;
}

function installTestMain(): TestMain {
  const handlers = new Map<string, Handler>();
  const listeners = new Map<string, Set<(data: unknown) => void>>();
  const invocations: { channel: string; args: unknown[] }[] = [];
  const ipcMain = {
    handle: (channel: string, handler: Handler) => handlers.set(channel, handler),
  } as unknown as IpcMain;

  const electronAPI: Window['electronAPI'] = {
    invoke: async (channel, ...args) => {
      const sent = structuredClone(args);
      invocations.push({ channel, args: sent });
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`No handler registered for '${channel}'`);
      return structuredClone(await handler({}, ...sent));
    },
    eventSend: (channel) => {
      throw new Error(`the test main has no listener for '${channel}'`);
    },
    eventOn: (channel, cb) => {
      const set = listeners.get(channel) ?? new Set();
      listeners.set(channel, set);
      set.add(cb);
      return () => set.delete(cb);
    },
    getPathForFile: () => {
      throw new Error('the test main has no files');
    },
  };
  const global = globalThis as unknown as { window?: { electronAPI?: unknown } };
  if (global.window?.electronAPI) throw new Error('window.electronAPI is already installed');
  global.window = Object.assign(global.window ?? {}, { electronAPI });

  return {
    serve: (router) => {
      handlers.clear();
      registerRPCRouter(router, ipcMain);
    },
    send: (channel, data) => {
      for (const cb of listeners.get(channel) ?? []) cb(structuredClone(data));
    },
    calls: (channel) => invocations.filter((i) => i.channel === channel).map((i) => i.args),
    reset: () => {
      handlers.clear();
      invocations.length = 0;
    },
  };
}

export const testMain = installTestMain();
