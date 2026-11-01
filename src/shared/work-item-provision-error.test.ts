import { describe, expect, it } from 'vitest';
import { parseProvisionError, serializeProvisionError } from './work-item-provision-error';

describe('provision errors stored on a work item', () => {
  it('round-trips a typed error, keeping the fields an action needs', () => {
    const stored = serializeProvisionError({
      type: 'base_fetch_failed',
      ref: 'origin/main',
      lastFetchedSha: '4505e9a2fbd67dd276bd32be9b057c7a0dffa9ec',
      message: 'Could not fetch origin/main.',
      gitOutput: "fatal: 'origin' does not appear to be a git repository",
    });

    expect(parseProvisionError(stored)).toEqual({
      type: 'base_fetch_failed',
      ref: 'origin/main',
      lastFetchedSha: '4505e9a2fbd67dd276bd32be9b057c7a0dffa9ec',
      message: 'Could not fetch origin/main.',
      gitOutput: "fatal: 'origin' does not appear to be a git repository",
    });
  });

  it("reads a fetch failure stored before git's output was kept apart (devstation-kcvy)", () => {
    const stored =
      '{"type":"base_fetch_failed","ref":"origin/main","lastFetchedSha":"4505e9a",' +
      '"message":"Could not fetch origin/main. Error: Command failed: git fetch"}';

    expect(parseProvisionError(stored)).toEqual({
      type: 'base_fetch_failed',
      ref: 'origin/main',
      lastFetchedSha: '4505e9a',
      message: 'Could not fetch origin/main. Error: Command failed: git fetch',
    });
  });

  it('throws on git output that is not text, instead of showing it', () => {
    expect(() =>
      parseProvisionError(
        '{"type":"base_fetch_failed","ref":"origin/main","lastFetchedSha":"4505e9a","message":"x","gitOutput":42}'
      )
    ).toThrow();
  });

  it('reads the shape migration 0048 gives errors stored before they were typed', () => {
    expect(parseProvisionError('{"type":"legacy","message":"git exploded"}')).toEqual({
      type: 'legacy',
      message: 'git exploded',
    });
  });

  it('throws on anything that is not a typed error, instead of guessing', () => {
    expect(() => parseProvisionError('git exploded')).toThrow();
    expect(() => parseProvisionError('{"message":"no type"}')).toThrow();
    expect(() => parseProvisionError('{"type":"base_fetch_failed","message":"x"}')).toThrow();
  });
});
