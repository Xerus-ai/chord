import { log } from '@renderer/utils/logger';
import { codeEditorPool } from './monaco-code-pool';
import { diffEditorPool } from './monaco-diff-pool';

const WARM_IDLE_TIMEOUT_MS = 3000;

let scheduled = false;

/**
 * Loads Monaco when the renderer is next idle, so the first diff or file the
 * user opens finds it ready. Called once the signed-in shell is on screen:
 * compiling the Monaco chunk takes the renderer's thread for several hundred
 * ms on a launch with no code cache, and doing that while the shell was still
 * waiting for its session held the shell back by as much (measured
 * 2026-10-15, scripts/perf/bench-startup.mjs). An editor that mounts sooner
 * loads Monaco itself (useMonaco). Idempotent.
 */
export function scheduleMonacoWarmup(): void {
  if (scheduled) return;
  scheduled = true;
  requestIdleCallback(
    () => {
      codeEditorPool.init(0).catch((error: unknown) => {
        log.warn('[monaco-code-pool] init failed:', error);
      });
      diffEditorPool.init(0).catch((error: unknown) => {
        log.warn('[monaco-diff-pool] init failed:', error);
      });
    },
    { timeout: WARM_IDLE_TIMEOUT_MS }
  );
}
