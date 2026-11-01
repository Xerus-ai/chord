import { homedir } from 'node:os';
import { describe, expect, it } from 'vitest';
import { probeClaudeCatalog } from './claude-catalog';

// Real CLI, no mocks: spawns the installed Claude Code through the Agent SDK
// and asks it for its model list. No prompt is sent, so no turn is billed.
describe('probeClaudeCatalog', () => {
  it(
    'returns the CLI model catalog with per-model effort levels',
    { timeout: 60_000 },
    async () => {
      const catalog = await probeClaudeCatalog(homedir());

      expect(catalog.providerId).toBe('claude');
      expect(catalog.models.length).toBeGreaterThan(0);
      expect(catalog.models.filter((m) => m.isDefault)).toHaveLength(1);
      expect(catalog.models.some((m) => m.efforts.length > 1)).toBe(true);
    }
  );
});
