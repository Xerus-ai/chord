import { describe, expect, it } from 'vitest';
import { compareVersions } from './version-compare';

/**
 * Agent update checks compare the probed installed version with the latest
 * one a release source reports (devstation-ext). Both are plain `X.Y.Z`
 * (`codex-cli 0.154.0`, npm's `latest`); anything else is reported, not read
 * as "no update".
 */
describe('compareVersions', () => {
  it('orders by each numeric part, not as text', () => {
    expect(compareVersions('0.154.0', '0.160.0')).toBe(-1);
    expect(compareVersions('0.10.0', '0.9.0')).toBe(1);
    expect(compareVersions('1.18.32', '1.18.34')).toBe(-1);
    expect(compareVersions('2.0.0', '1.99.99')).toBe(1);
  });

  it('reports equal versions as equal', () => {
    expect(compareVersions('0.160.0', '0.160.0')).toBe(0);
  });

  it('throws on a version that is not X.Y.Z', () => {
    expect(() => compareVersions('codex-cli', '0.160.0')).toThrow(/codex-cli/);
    expect(() => compareVersions('0.160.0', '1.2')).toThrow(/1\.2/);
    expect(() => compareVersions('0.162.0-alpha.12', '0.160.0')).toThrow(/0\.162\.0-alpha\.12/);
  });
});
