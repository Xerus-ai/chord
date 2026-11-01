import { resolve } from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import { playwright } from '@vitest/browser-playwright';
import { defineConfig } from 'vitest/config';

const alias = {
  '@': resolve(__dirname, 'src'),
  '@root': resolve(__dirname, '.'),
  '@shared': resolve(__dirname, 'src/shared'),
  '@renderer': resolve(__dirname, 'src/renderer'),
  '@main': resolve(__dirname, 'src/main'),
};

// `account/config.ts` reads these at module load, and it sits in the import
// graph of the sync queue every artifact write goes through. Outside Electron
// `app` is undefined, so an unset variable crashes the import instead of
// reading as "dev build". Suites exercise the real modules with a fixed
// account configuration; the URLs point at a closed loopback port, so nothing
// can reach a real auth server.
const nodeTestEnv = {
  CHORD_AUTH_SERVER_URL: 'http://127.0.0.1:9',
  WORKOS_CLIENT_ID: 'chord-test-client',
  WORKOS_REDIRECT_URI: 'http://127.0.0.1:9/callback',
  WORKOS_AUTHKIT_URL: 'http://127.0.0.1:9/authkit',
};

// Suites that start the installed `codex app-server`. A server still going
// down holds its CODEX_HOME state, and one started meanwhile exits with code 1.
// The client waits for servers it closed itself (`codex-shutdown-registry.ts`), but
// only within one process — so these files share one worker and run in turn.
const realCodexSuites = [
  'src/main/core/codex-app-server/app-server-client.test.ts',
  'src/main/core/codex-app-server/codex-catalog.test.ts',
  'src/main/core/codex-app-server/codex-session.test.ts',
  'src/main/core/codex-app-server/codex-session-restart.test.ts',
  'src/main/core/codex-app-server/codex-rate-limits.test.ts',
  'src/main/core/chat-history/fork-codex-thread.test.ts',
  // Runs the installed Codex in a real PTY to check its update prompt.
  'src/main/core/conversations/impl/agent-command.test.ts',
];

// Suites that run real dev servers on lane ports (`core/lane-runs`). Each has
// its own test database, so each allocates the first port block (CHORD_PORT
// 50000): side by side, two of them bind the same port and one server never
// comes up. The free-port check at allocation cannot see a server another
// worker has yet to start, so these files run one at a time.
const laneRunSuites = ['src/main/core/lane-runs/**/*.test.ts'];

// Suites that drive the Solo host (`core/solo`): real repositories, lanes as
// `git worktree`s, run scripts as PTY processes stopped with Ctrl+C. Unloaded
// a test takes 5-17s (~15 git spawns of setup, then real hand-overs); inside
// the parallel pool beside ~550 other files the same tests took 25-75s and
// blew the 30s ceiling in 3 of 4 full runs on 2026-10-06 (devstation-ce5),
// while all 9 files passed together on their own in 157s. They run as their
// own group after the others, still in parallel with each other.
const soloSuites = ['src/main/core/solo/**/*.test.ts'];

export default defineConfig({
  resolve: { alias },
  test: {
    // Vitest sizes the pool by CPU (19 workers on this 20-thread, 16 GB box),
    // not by memory. On 2026-10-16 the node project alone, under the same
    // load: 19 workers took 79s and drew free RAM from 3.3 GB to 0.47 GB
    // (workers peaking at 2.46 GB together, plus their git and PTY children);
    // 8 workers took 136s with workers at 1.32 GB and free RAM never below
    // 1.29 GB. With an editor, a browser or a dev server holding the rest,
    // the 19-worker pool paged the machine: three gate verifies that day
    // failed on 30s/60s timeouts and a dead worker (devstation-k3nu). Projects
    // that set their own count (server) keep it.
    maxWorkers: 8,
    // The default output, plus the files a dying worker left unfinished,
    // by name (devstation-ce5).
    reporters: ['default', './scripts/vitest/unfinished-files-reporter.ts'],
    projects: [
      {
        // All existing tests that run in a Node.js environment.
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          // The e2e harness's own logic, where it touches the user's files, and the release
          // scripts' publish order (devstation-lj03).
          include: [
            'src/**/*.test.ts',
            'scripts/e2e/**/*.test.mjs',
            'scripts/release/**/*.test.ts',
            'scripts/leak-guard/**/*.test.ts',
            'scripts/*.test.ts',
          ],
          exclude: [
            '**/_*/**',
            'src/renderer/tests/browser/**',
            ...realCodexSuites,
            ...laneRunSuites,
            ...soloSuites,
          ],
          // Ten suites here drive a real `git` against real repositories on
          // disk. Spawning processes on Windows is slow enough that under the
          // parallel worker pool they intermittently blow vitest's 5s default —
          // `worktree-service` and `checkpoint-refs` were both measured failing
          // roughly one run in three, on an otherwise untouched tree. The work
          // is legitimate, so the ceiling is raised to mean "genuinely stuck"
          // rather than "unlucky scheduling".
          testTimeout: 30_000,
          // The same holds for hooks: `lane-preflight`, `lane-checkout`,
          // `resolve-lane-base` and `worktree-diff-stats` build their repos in
          // `beforeEach` (~11 git spawns). On 2026-10-03, on an idle machine,
          // the full run took `lane-preflight` 95.8s for 11 tests and all four
          // blew the 10s hook default (6 tests). A timed-out hook is not
          // cancelled: it keeps running git in a directory `afterEach` is
          // removing (EPERM) and, through the shared `let`s, clones into the
          // next test's directory ("already exists").
          hookTimeout: 30_000,
          env: nodeTestEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'node-codex',
          environment: 'node',
          include: realCodexSuites,
          fileParallelism: false,
          isolate: false,
          // Runs as its own group once the parallel projects are done.
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
          env: nodeTestEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'node-lane-runs',
          environment: 'node',
          include: laneRunSuites,
          exclude: ['**/_*/**'],
          fileParallelism: false,
          // Runs as its own group once the parallel projects are done.
          sequence: { groupOrder: 1 },
          testTimeout: 30_000,
          hookTimeout: 30_000,
          env: nodeTestEnv,
        },
      },
      {
        extends: true,
        test: {
          name: 'node-solo',
          environment: 'node',
          include: soloSuites,
          exclude: ['**/_*/**'],
          // Its own group, after the others: vitest runs a group's projects
          // together only when they share a worker count.
          sequence: { groupOrder: 3 },
          testTimeout: 30_000,
          hookTimeout: 30_000,
          env: nodeTestEnv,
        },
      },
      {
        // Cloud sync server tests. `server/` is a separate pnpm workspace member
        // with its own tsconfig, so its files match neither the root tsconfig's
        // include nor the 'node' project's `src/**` glob.
        extends: true,
        test: {
          name: 'server',
          environment: 'node',
          include: ['server/src/**/*.test.ts'],
          // The real-DB suites boot an in-process PGlite and apply every
          // migration in `beforeAll` — measured at ~8s per file when run alone.
          // That sits under vitest's 10s hook default only on an idle machine:
          // in the full parallel run all four timed out in `beforeAll` while
          // passing 20/20 in isolation. As with the node project's testTimeout,
          // the ceiling is raised to mean "stuck", not "busy".
          hookTimeout: 60_000,
          // Runs as its own group after the node suites. Sharing the pool with
          // them (esbuild bundling, git, PGlite boots in ~270 files at once)
          // pushed every suite that imports the full route tree past the 60s
          // hook ceiling — all 8 timed out in the combined run on 2026-09-26
          // while the server project alone passed 30/30 in ~66s.
          sequence: { groupOrder: 2 },
          // Fifteen suites boot their own PGlite (WASM, CPU-bound, ~5s alone)
          // and import the full route tree (~5s alone, transformed by the one
          // vitest main process). Started all at once on every core they
          // starve each other: on 2026-09-26 the project alone failed 1 run in
          // 2 with 11 `beforeAll` hooks past 60s on 19 workers, and passed 3
          // runs in 3 on 6 workers — faster, too (67–72s against 76s).
          maxWorkers: 6,
        },
      },
      {
        // Renderer terminal tests that need a real browser environment
        // (real CSS layout, ResizeObserver, requestAnimationFrame, WebGL).
        extends: true,
        // The app's own CSS pipeline, so a suite that imports `index.css`
        // measures the real layout (truncation, flex) rather than unstyled boxes.
        plugins: [tailwindcss()],
        // Dependencies Vite would otherwise find only while a test runs: it
        // then re-bundles and reloads the page under the running tests, which
        // fail with "Invalid hook call" or "Failed to fetch dynamically
        // imported module" (2026-10-06: base-ui's popover and menu, first
        // rendered by the turn footer's suites, and from a cold cache the JSX
        // dev runtime; 2026-10-07: tooltip and button, first rendered by the
        // tooltip-trigger suite).
        optimizeDeps: {
          include: [
            '@base-ui/react/popover',
            '@base-ui/react/menu',
            '@base-ui/react/tooltip',
            '@base-ui/react/button',
            'react/jsx-dev-runtime',
          ],
        },
        test: {
          name: 'browser',
          // Vitest's browser default, 63315, is inside a port range Windows
          // reserves for Hyper-V/WinNAT on this machine (63232-63331): the
          // Vite server then dies with `listen EACCES ::1:63315` as an
          // unhandled error and fails the whole run (2026-10-15).
          browser: {
            enabled: true,
            api: { port: 63400 },
            provider: playwright(),
            headless: true,
            instances: [{ browser: 'chromium' }],
            // A failing test's screenshot is a run artifact, kept out of the
            // test tree (and git): written beside a test it reads as a test
            // file changed during implement.
            screenshotDirectory: 'screenshots/vitest',
          },
          include: ['src/renderer/tests/browser/**/*.test.{ts,tsx}'],
          // Its own group, last. Beside the node pool, Vite serves the test
          // files slowly enough that Chromium's import of them fails: on
          // 2026-10-06 four files failed "Failed to fetch dynamically imported
          // module" in a full run while all 12 passed alone in 13s
          // (devstation-ce5).
          sequence: { groupOrder: 4 },
        },
      },
    ],
  },
});
