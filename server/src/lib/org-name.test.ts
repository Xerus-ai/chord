import { describe, expect, it } from 'vitest';
import { resolveAdoptedOrgName } from './org-name.js';

describe('resolveAdoptedOrgName', () => {
  it('replaces a name that is just the signup address’s consumer domain', () => {
    expect(resolveAdoptedOrgName('gmail.com', 'someone@gmail.com', 'Raghav')).toBe(
      "Raghav's workspace"
    );
  });

  it('matches the domain case-insensitively and ignores surrounding space', () => {
    expect(resolveAdoptedOrgName(' Gmail.com ', 'someone@GMAIL.com', 'Raghav')).toBe(
      "Raghav's workspace"
    );
  });

  it('leaves a corporate domain alone even when it is the org name', () => {
    // Renaming this would rename the workspace for every member of a real
    // company org. Settings covers it instead.
    expect(resolveAdoptedOrgName('acme.com', 'dev@acme.com', 'Dev')).toBe('acme.com');
  });

  it('leaves a real name alone for a consumer address', () => {
    expect(resolveAdoptedOrgName('Acme Engineering', 'someone@gmail.com', 'Raghav')).toBe(
      'Acme Engineering'
    );
  });

  it('leaves the name alone when the org name is a different consumer domain', () => {
    expect(resolveAdoptedOrgName('yahoo.com', 'someone@gmail.com', 'Raghav')).toBe('yahoo.com');
  });

  it('leaves the name alone when there is no email', () => {
    expect(resolveAdoptedOrgName('gmail.com', null, 'Raghav')).toBe('gmail.com');
    expect(resolveAdoptedOrgName('gmail.com', undefined, 'Raghav')).toBe('gmail.com');
  });

  it('leaves the name alone for a malformed address with no domain', () => {
    expect(resolveAdoptedOrgName('gmail.com', 'raghav', 'Raghav')).toBe('gmail.com');
  });
});
