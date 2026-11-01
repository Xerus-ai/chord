/**
 * How a sidebar lane row shares a narrow width. Every lane of a repository
 * usually merges into the same target, so the branch's end is what tells
 * lanes apart: it keeps its room before "→ target" gets any. With the target
 * first, a narrow row read "r… → origin/main" (devstation-kgua). The tooltip
 * carries every part.
 */
import { describe, expect, it } from 'vitest';
import { fitLaneLabel } from './fit-lane-label';

/** Seven pixels a character, the ellipsis included. */
const measure = (text: string) => text.length * 7;

const BRANCH = 'chorddeveloper/phase-1-setup-1791360049041-15a';
const SUFFIX = ' → origin/main';

function shownTail(tailLength: number): string {
  return BRANCH.slice(BRANCH.length - tailLength);
}

describe('fitLaneLabel', () => {
  it("keeps the branch's last eight characters before the target, which is cut instead", () => {
    // Room for 14 characters: the tail (8) and its "…", then 5 of the target.
    const fit = fitLaneLabel({
      available: 14 * 7,
      title: null,
      branch: BRANCH,
      suffix: SUFFIX,
      measure,
    });

    expect(fit.tailLength).toBe(8);
    expect(shownTail(fit.tailLength)).toBe('9041-15a');
    expect(fit.suffixWidth).toBe(5 * 7);
    expect(fit.headWidth).toBe(7);
  });

  it('shows the whole target once the tail has its room', () => {
    // 8 tail + 1 ellipsis + 14 target = 23 characters.
    const fit = fitLaneLabel({
      available: 23 * 7,
      title: null,
      branch: BRANCH,
      suffix: SUFFIX,
      measure,
    });

    expect(fit.tailLength).toBe(8);
    expect(fit.suffixWidth).toBe(SUFFIX.length * 7);
  });

  it('gives the title room only after the tail and the target', () => {
    const fit = fitLaneLabel({
      available: 23 * 7,
      title: 'Phase 1 setup',
      branch: BRANCH,
      suffix: SUFFIX,
      measure,
    });

    expect(fit.titleWidth).toBe(0);
    expect(fit.tailLength).toBe(8);
    expect(fit.suffixWidth).toBe(SUFFIX.length * 7);
  });

  it('shows everything on a row wide enough for it', () => {
    const fit = fitLaneLabel({
      available: 200 * 7,
      title: 'Phase 1 setup',
      branch: BRANCH,
      suffix: SUFFIX,
      measure,
    });

    expect(fit.titleWidth).toBe('Phase 1 setup'.length * 7);
    expect(fit.suffixWidth).toBe(SUFFIX.length * 7);
    expect(fit.tailLength).toBe(12);
    expect(fit.headWidth).toBe((BRANCH.length - 12) * 7);
  });

  it('shows a short branch whole, with no ellipsis to reserve', () => {
    const fit = fitLaneLabel({
      available: 10 * 7,
      title: null,
      branch: 'main-a2e',
      suffix: SUFFIX,
      measure,
    });

    expect(fit.tailLength).toBe(8);
    expect(fit.suffixWidth).toBe(2 * 7);
  });
});
