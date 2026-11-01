import { describe, expect, it } from 'vitest';
import { serializeProvisionError } from '@shared/work-item-provision-error';
import { planProvisionRetry } from './provision-retry-plan';

/**
 * devstation-dq2: a Retry may take over a checkout git left behind only when
 * the stored failure says provisioning was cut off mid-way — the one case where
 * git can have finished `worktree add` with no row pointing at it. Every other
 * failure retries the create as asked, so an existing branch stays refused.
 */
describe('planProvisionRetry', () => {
  it('resumes the checkout of an item whose provisioning was interrupted', () => {
    const provisionError = serializeProvisionError({
      type: 'interrupted',
      message: 'Creating the checkout was interrupted when Chord closed.',
    });

    expect(planProvisionRetry({ provisionError })).toEqual({ resumeInterrupted: true });
  });

  it('does not resume after a branch_exists failure', () => {
    const provisionError = serializeProvisionError({
      type: 'branch_exists',
      branch: 'chord/fix-login-a1b',
      message: 'A branch named chord/fix-login-a1b already exists.',
    });

    expect(planProvisionRetry({ provisionError })).toEqual({ resumeInterrupted: false });
  });

  it('does not resume after a base_fetch_failed failure', () => {
    const provisionError = serializeProvisionError({
      type: 'base_fetch_failed',
      ref: 'origin/main',
      lastFetchedSha: '0123456789abcdef0123456789abcdef01234567',
      message: 'Could not fetch origin/main.',
    });

    expect(planProvisionRetry({ provisionError })).toEqual({ resumeInterrupted: false });
  });

  it('does not resume when no error is stored', () => {
    expect(planProvisionRetry({ provisionError: null })).toEqual({ resumeInterrupted: false });
  });

  it('throws on a stored value that is not a typed error, instead of guessing', () => {
    expect(() => planProvisionRetry({ provisionError: 'worktree add failed' })).toThrow();
  });
});
