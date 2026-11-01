import { describe, expect, it } from 'vitest';
import { deriveChecksPassing, deriveChecksState } from './checks-passing';

const HEAD = 'abc123';

describe('deriveChecksState', () => {
  it('is none when no check runs against the head commit', () => {
    expect(deriveChecksState([], HEAD)).toBe('none');
    expect(
      deriveChecksState([{ commitSha: 'stale', status: 'COMPLETED', conclusion: 'SUCCESS' }], HEAD)
    ).toBe('none');
  });

  it('is pending while a check on the head commit has not completed', () => {
    expect(
      deriveChecksState(
        [
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'SUCCESS' },
          { commitSha: HEAD, status: 'IN_PROGRESS', conclusion: null },
        ],
        HEAD
      )
    ).toBe('pending');
    expect(deriveChecksState([{ commitSha: HEAD, status: 'QUEUED', conclusion: null }], HEAD)).toBe(
      'pending'
    );
  });

  it('is passing when every completed check succeeded, was neutral, or was skipped', () => {
    expect(
      deriveChecksState(
        [
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'SUCCESS' },
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'NEUTRAL' },
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'SKIPPED' },
        ],
        HEAD
      )
    ).toBe('passing');
  });

  it('is failing when any completed check did not pass', () => {
    expect(
      deriveChecksState(
        [
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'SUCCESS' },
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'FAILURE' },
        ],
        HEAD
      )
    ).toBe('failing');
  });

  it('separates "no checks" from "still running", which deriveChecksPassing collapses', () => {
    const none = deriveChecksState([], HEAD);
    const pending = deriveChecksState(
      [{ commitSha: HEAD, status: 'IN_PROGRESS', conclusion: null }],
      HEAD
    );
    expect(none).not.toBe(pending);
    expect(deriveChecksPassing([], HEAD)).toBeNull();
    expect(
      deriveChecksPassing([{ commitSha: HEAD, status: 'IN_PROGRESS', conclusion: null }], HEAD)
    ).toBeNull();
  });
});

describe('deriveChecksPassing', () => {
  it('is null with no checks on the head commit', () => {
    expect(deriveChecksPassing([], HEAD)).toBeNull();
    expect(
      deriveChecksPassing(
        [{ commitSha: 'stale', status: 'COMPLETED', conclusion: 'SUCCESS' }],
        HEAD
      )
    ).toBeNull();
  });

  it('is null while any check on the head commit is still running', () => {
    expect(
      deriveChecksPassing(
        [
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'SUCCESS' },
          { commitSha: HEAD, status: 'IN_PROGRESS', conclusion: null },
        ],
        HEAD
      )
    ).toBeNull();
  });

  it('is true when every completed check passed', () => {
    expect(
      deriveChecksPassing(
        [
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'SUCCESS' },
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'NEUTRAL' },
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'SKIPPED' },
        ],
        HEAD
      )
    ).toBe(true);
  });

  it('is false when any completed check failed', () => {
    expect(
      deriveChecksPassing(
        [
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'SUCCESS' },
          { commitSha: HEAD, status: 'COMPLETED', conclusion: 'FAILURE' },
        ],
        HEAD
      )
    ).toBe(false);
  });
});
