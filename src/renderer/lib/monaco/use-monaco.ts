import type * as monaco from 'monaco-editor';
import { useEffect, useState } from 'react';
import { codeEditorPool } from './monaco-code-pool';

/**
 * Monaco for a component that mounts an editor: null until it has loaded,
 * then the namespace, with a re-render when it arrives.
 *
 * Monaco is its own chunk, loaded on first use — the shell warms it when idle
 * (warm-monaco.ts) — so the first screen never waits for it. Before this, the
 * renderer awaited Monaco before its first render, and an editor that mounted
 * while it was still loading stayed blank. A failed load throws to the
 * nearest error boundary.
 */
export function useMonaco(): typeof monaco | null {
  const [loaded, setLoaded] = useState(() => codeEditorPool.getMonaco());
  const [failure, setFailure] = useState<{ error: unknown } | null>(null);

  useEffect(() => {
    if (loaded) return;
    let live = true;
    codeEditorPool.init(0).then(
      () => {
        if (live) setLoaded(codeEditorPool.getMonaco());
      },
      (error: unknown) => {
        if (live) setFailure({ error });
      }
    );
    return () => {
      live = false;
    };
  }, [loaded]);

  if (failure) throw failure.error;
  return loaded;
}
