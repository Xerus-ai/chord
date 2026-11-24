import { parseArgs } from 'node:util';

export interface VerifyMacOptions {
  /** Run codesign's checks; false only for --unsigned. */
  codesign: boolean;
  /** The Developer ID team the signature must name, when given. */
  expectedTeamId: string | undefined;
}

/**
 * verify-mac.ts's flags. Builds are unsigned until signing is provisioned (D8): --unsigned keeps
 * the arch checks and skips the signature checks. It cannot be combined with a team id.
 */
export function readVerifyMacOptions(args: string[]): VerifyMacOptions {
  const { values } = parseArgs({
    args,
    options: {
      'expected-team-id': { type: 'string' },
      unsigned: { type: 'boolean', default: false },
    },
    strict: true,
  });
  const expectedTeamId = values['expected-team-id'];
  if (values.unsigned && expectedTeamId) {
    throw new Error('--unsigned and --expected-team-id contradict');
  }
  return { codesign: !values.unsigned, expectedTeamId };
}
