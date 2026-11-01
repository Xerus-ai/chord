import { describe, expect, it } from 'vitest';
import { findInvalidEnvKeys } from './ProviderEnvVarEditor';

const entries = (...keys: string[]) => keys.map((key, id) => ({ id, key, value: 'v' }));

describe('findInvalidEnvKeys', () => {
  it('accepts POSIX-portable names', () => {
    expect(findInvalidEnvKeys(entries('PATH', '_UNDERSCORE', 'API_KEY_2'))).toEqual([]);
  });

  it('rejects names that would not survive being exported to a shell', () => {
    expect(findInvalidEnvKeys(entries('2LEADING', 'has-dash', 'has space', 'has.dot'))).toEqual([
      '2LEADING',
      'has-dash',
      'has space',
      'has.dot',
    ]);
  });

  it('ignores blank rows so an empty new row does not block saving', () => {
    expect(findInvalidEnvKeys(entries('', '   '))).toEqual([]);
  });

  it('trims before validating, so a padded valid key is accepted', () => {
    expect(findInvalidEnvKeys(entries('  API_KEY  '))).toEqual([]);
  });
});
