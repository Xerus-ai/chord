import { describe, expect, it } from 'vitest';
import {
  loadReadNotificationIds,
  saveReadNotificationIds,
  type ReadIdStorage,
} from './read-notifications-store';

function createStorage(initial?: Record<string, string>): ReadIdStorage {
  const entries = new Map<string, string>(Object.entries(initial ?? {}));
  return {
    getItem: (key) => entries.get(key) ?? null,
    setItem: (key, value) => {
      entries.set(key, value);
    },
  };
}

const KEY = 'chord:notifications:read:v1';

describe('read notifications store', () => {
  it('starts empty when nothing was persisted', () => {
    expect(loadReadNotificationIds(createStorage())).toEqual(new Set());
  });

  it('round-trips read ids across a reload', () => {
    const storage = createStorage();
    saveReadNotificationIds(storage, new Set(), ['n1', 'n2']);
    expect(loadReadNotificationIds(storage)).toEqual(new Set(['n1', 'n2']));
  });

  it('merges new ids into the ids already known', () => {
    const storage = createStorage();
    const first = saveReadNotificationIds(storage, new Set(), ['n1']);
    const second = saveReadNotificationIds(storage, first, ['n2']);
    expect(second).toEqual(new Set(['n1', 'n2']));
    expect(loadReadNotificationIds(storage)).toEqual(new Set(['n1', 'n2']));
  });

  it('does not record an id twice', () => {
    const storage = createStorage();
    const known = saveReadNotificationIds(storage, new Set(['n1']), ['n1', 'n1']);
    expect([...known]).toEqual(['n1']);
    expect(JSON.parse(storage.getItem(KEY) as string)).toEqual(['n1']);
  });

  it('keeps the newest ids when the list outgrows its cap', () => {
    const storage = createStorage();
    const many = Array.from({ length: 250 }, (_, i) => `n${i}`);
    const known = saveReadNotificationIds(storage, new Set(), many);
    expect(known.size).toBe(200);
    expect(known.has('n249')).toBe(true);
    expect(known.has('n49')).toBe(false);
  });

  it('rejects a persisted value that is not a list of ids', () => {
    const storage = createStorage({ [KEY]: '{"n1":true}' });
    expect(() => loadReadNotificationIds(storage)).toThrow(/expected an array/);
  });

  it('ignores non-string entries rather than trusting them as ids', () => {
    const storage = createStorage({ [KEY]: '["n1", 7, null, "n2"]' });
    expect(loadReadNotificationIds(storage)).toEqual(new Set(['n1', 'n2']));
  });
});
