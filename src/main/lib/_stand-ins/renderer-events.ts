import type { events as mainEvents } from '@main/lib/events';

/**
 * A stand-in for `@main/lib/events` in main-process suites: it records what
 * main would send the renderer.
 *
 *   vi.mock('@main/lib/events', () => import('@main/lib/_stand-ins/renderer-events'));
 *
 * The real emitter cannot serve a Node test run: `emit` delivers only through
 * the main window's webContents, so nothing the suite can read ever receives
 * it, and `on` registers on Electron's `ipcMain`, which is undefined outside
 * Electron (every PTY a lane run starts subscribes through it,
 * `pty-session-registry.ts`). This is a mock and is counted as one: the
 * scorecard (`module_mocks.py`) reads only `_testing/` and `test-support/`
 * modules as real injections, never `_stand-ins/` (devstation-4x42.254).
 *
 * Every suite file loads its own copy, so `emitted` holds that file's events;
 * a suite clears it before each test.
 */
export type EmittedEvent = { channel: string; payload: unknown; topic?: string };

export const emitted: EmittedEvent[] = [];

export const events: typeof mainEvents = {
  emit: (event, payload, topic) => {
    emitted.push(
      topic === undefined
        ? { channel: event.name, payload }
        : { channel: event.name, payload, topic }
    );
  },
  // Main's `on` hears only what the renderer sends; no renderer runs here.
  on: () => () => {},
  once: () => () => {},
};
