import { describe, expect, it } from 'vitest';
import { canSaveWorkspaceName } from './workspace-name';

describe('canSaveWorkspaceName', () => {
  it('rejects an empty field', () => {
    expect(canSaveWorkspaceName('', 'gmail.com')).toBe(false);
  });

  it('rejects a field holding only whitespace', () => {
    expect(canSaveWorkspaceName('   ', 'gmail.com')).toBe(false);
  });

  it('rejects the current name typed back verbatim', () => {
    expect(canSaveWorkspaceName('gmail.com', 'gmail.com')).toBe(false);
  });

  it('rejects the current name surrounded by whitespace', () => {
    expect(canSaveWorkspaceName('  gmail.com  ', 'gmail.com')).toBe(false);
  });

  it('accepts a genuinely different name', () => {
    expect(canSaveWorkspaceName('Acme Engineering', 'gmail.com')).toBe(true);
  });

  it('accepts any non-empty name when the org has no name yet', () => {
    expect(canSaveWorkspaceName('Acme Engineering', '')).toBe(true);
  });
});
