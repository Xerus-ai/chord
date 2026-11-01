import type { StoreApi } from 'zustand/vanilla';
import { rpc } from '@renderer/lib/ipc';

function structuralEqual(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class SnapshotRegistry {
  private readonly disposers = new Map<string, () => void>();

  register<T>(key: string, store: StoreApi<T>, getSnapshot: (state: T) => unknown): () => void {
    this.disposers.get(key)?.();

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastSnapshot: unknown = getSnapshot(store.getState());

    const unsubscribe = store.subscribe((state) => {
      const next = getSnapshot(state);
      if (structuralEqual(next, lastSnapshot)) return;
      lastSnapshot = next;

      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        void rpc.viewState.save(key, next);
      }, 1000);
    });

    const dispose = () => {
      unsubscribe();
      if (debounceTimer) clearTimeout(debounceTimer);
      this.disposers.delete(key);
    };

    this.disposers.set(key, dispose);
    return dispose;
  }
}

export const snapshotRegistry = new SnapshotRegistry();
