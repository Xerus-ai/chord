import { describe, expect, it } from 'vitest';
import { readVerifyMacOptions } from './verify-mac-options.ts';

/**
 * verify-mac.ts's flags (devstation-pqub): release.yml's mac build runs it with --unsigned until
 * signing is provisioned (D8). The script exits off macOS, so its options are read here.
 */
describe('readVerifyMacOptions', () => {
  it('checks the signature by default', () => {
    expect(readVerifyMacOptions([])).toEqual({ codesign: true, expectedTeamId: undefined });
  });

  it('--unsigned skips the codesign checks', () => {
    expect(readVerifyMacOptions(['--unsigned'])).toEqual({
      codesign: false,
      expectedTeamId: undefined,
    });
  });

  it('--expected-team-id keeps the codesign checks and names the team', () => {
    expect(readVerifyMacOptions(['--expected-team-id', 'ABCDE12345'])).toEqual({
      codesign: true,
      expectedTeamId: 'ABCDE12345',
    });
  });

  it('refuses --unsigned with --expected-team-id: a release cannot be both', () => {
    expect(() => readVerifyMacOptions(['--unsigned', '--expected-team-id', 'ABCDE12345'])).toThrow(
      '--unsigned and --expected-team-id contradict'
    );
  });

  it('refuses an unknown flag rather than verifying less than asked', () => {
    expect(() => readVerifyMacOptions(['--unsinged'])).toThrow();
  });
});
