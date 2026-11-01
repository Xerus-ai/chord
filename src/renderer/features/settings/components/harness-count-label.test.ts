import { describe, expect, it } from 'vitest';
import { describeHarnessCount } from './harness-count-label';

/**
 * A CLI agent row's expander showed a bare count ("> 11") beside the version,
 * which read as part of it (devstation-nj4). It names what it counts.
 */
describe('describeHarnessCount', () => {
  it('names skills and commands, each with its count', () => {
    expect(describeHarnessCount(3, 8)).toBe('3 skills, 8 commands');
  });

  it('uses the singular for one, and leaves out a kind with none', () => {
    expect(describeHarnessCount(1, 0)).toBe('1 skill');
    expect(describeHarnessCount(0, 1)).toBe('1 command');
  });
});
