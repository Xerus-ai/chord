import { describe, expect, it } from 'vitest';
import { artifactStatusBadge } from './artifact-status';

/**
 * The artifact's status on its file bar (shared-items step 4, decision 1): it
 * moves there from the rail's "This artifact" section, which step 4 deletes.
 */
describe('artifactStatusBadge', () => {
  it('names each status with its signal', () => {
    expect(artifactStatusBadge('draft')).toEqual({ label: 'Draft', signal: 'neutral' });
    expect(artifactStatusBadge('in_review')).toEqual({ label: 'In review', signal: 'warning' });
    expect(artifactStatusBadge('approved')).toEqual({ label: 'Approved', signal: 'success' });
    expect(artifactStatusBadge('built')).toEqual({ label: 'Built', signal: 'success' });
  });

  it('shows no badge for an artifact without a status', () => {
    expect(artifactStatusBadge(null)).toBeNull();
  });

  it('refuses a status it does not know rather than showing a raw word', () => {
    expect(() => artifactStatusBadge('archived')).toThrow();
  });
});
