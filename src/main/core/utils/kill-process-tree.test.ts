import { describe, expect, it } from 'vitest';
import { killProcessTree } from './kill-process-tree';

describe('killProcessTree', () => {
  // Windows pids are multiples of 4: an odd pid is never assigned, so this asks taskkill about
  // a root that cannot exist and touches no process (devstation-v1x2).
  it.runIf(process.platform === 'win32')(
    'reports a root that is not there as not-found',
    async () => {
      expect(await killProcessTree(3)).toBe('not-found');
    }
  );
});
