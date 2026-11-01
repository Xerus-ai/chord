import { describe, expect, it, vi } from 'vitest';
import { RepoFetchRegistry, type FetchLifecycle } from './repo-fetch-registry';

function makeFetchable(): {
  fetchable: FetchLifecycle;
  start: ReturnType<typeof vi.fn>;
  stop: ReturnType<typeof vi.fn>;
} {
  const start = vi.fn();
  const stop = vi.fn();
  return { fetchable: { start, stop }, start, stop };
}

describe('RepoFetchRegistry', () => {
  it('creates and starts a fetch service once per project, on first acquire', () => {
    const { fetchable, start } = makeFetchable();
    const createService = vi.fn(() => fetchable);
    const registry = new RepoFetchRegistry(createService);

    const first = registry.acquire('project-a', '/repo/a');
    const second = registry.acquire('project-a', '/repo/a');

    expect(first).toBe(fetchable);
    expect(second).toBe(fetchable);
    expect(createService).toHaveBeenCalledTimes(1);
    expect(createService).toHaveBeenCalledWith('/repo/a');
    expect(start).toHaveBeenCalledTimes(1);
    expect(registry.refCount('project-a')).toBe(2);
  });

  it('creates a separate fetch service per project', () => {
    const a = makeFetchable();
    const b = makeFetchable();
    const createService = vi.fn((path: string) => (path === '/repo/a' ? a.fetchable : b.fetchable));
    const registry = new RepoFetchRegistry(createService);

    registry.acquire('project-a', '/repo/a');
    registry.acquire('project-b', '/repo/b');

    expect(createService).toHaveBeenCalledTimes(2);
    expect(a.start).toHaveBeenCalledTimes(1);
    expect(b.start).toHaveBeenCalledTimes(1);
  });

  it('does not stop the fetch service until the last release', () => {
    const { fetchable, stop } = makeFetchable();
    const registry = new RepoFetchRegistry(() => fetchable);

    registry.acquire('project-a', '/repo/a');
    registry.acquire('project-a', '/repo/a');

    registry.release('project-a');
    expect(stop).not.toHaveBeenCalled();
    expect(registry.refCount('project-a')).toBe(1);

    registry.release('project-a');
    expect(stop).toHaveBeenCalledTimes(1);
    expect(registry.refCount('project-a')).toBe(0);
  });

  it('starts a fresh fetch service if acquired again after being fully released', () => {
    const { fetchable, start, stop } = makeFetchable();
    const createService = vi.fn(() => fetchable);
    const registry = new RepoFetchRegistry(createService);

    registry.acquire('project-a', '/repo/a');
    registry.release('project-a');
    registry.acquire('project-a', '/repo/a');

    expect(createService).toHaveBeenCalledTimes(2);
    expect(start).toHaveBeenCalledTimes(2);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('ignores release for an unknown project', () => {
    const registry = new RepoFetchRegistry(() => makeFetchable().fetchable);
    expect(() => registry.release('missing')).not.toThrow();
  });
});
