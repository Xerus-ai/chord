import { describe, expect, it } from 'vitest';
import { execFile } from './exec.ts';

/** A node child that prints its arguments as JSON, as the program received them. */
const PRINT_ARGS = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))';

describe('execFile', () => {
  it('passes each argument through unchanged, as one argument, with no shell reading it', () => {
    const args = ['a $b %c% `d', '--config.releaseInfo.releaseNotesFile=C:\\notes dir\\v1.0.0.md'];

    const out = execFile(process.execPath, ['-e', PRINT_ARGS, ...args]);

    expect(JSON.parse(out)).toEqual(args);
  });

  it('fails with the command, its exit status and its stderr', () => {
    expect(() =>
      execFile(process.execPath, ['-e', 'process.stderr.write("broke"); process.exit(3)'])
    ).toThrow(/^Command failed \(exit 3\): .*node.* -e .*\nbroke$/s);
  });
});
