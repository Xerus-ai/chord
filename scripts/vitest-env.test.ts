import { describe, expect, it } from 'vitest';

/**
 * Tests read no `.env` file (devstation-mg6u.60). Vite loads `.env` from the app root into
 * `import.meta.env` by default; a writer has the main app's `.env` copied in and CI has none, so
 * a test that leaned on one passed gate verify and failed CI (PR #32). Values a test needs are
 * pinned in vitest.config.ts, the same everywhere. This fails in any tree whose `.env` sets a
 * VITE_ variable while the config still loads it.
 */
describe('vitest environment', () => {
  it('holds no VITE_ variable from a .env file in the app root', () => {
    const fromEnvFile = Object.keys(import.meta.env).filter((key) => key.startsWith('VITE_'));

    expect(fromEnvFile).toEqual([]);
  });
});
