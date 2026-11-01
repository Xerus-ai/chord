import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { builderArgs, electronBuilderCli } from './builder-command.ts';

const temps: string[] = [];
afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const base = {
  platform: 'win',
  targets: 'nsis msi',
  arch: 'x64',
  config: 'electron-builder.config.ts',
} as const;

/** A release notes file inside `dirName`, under a fresh temp dir. */
function createNotes(dirName: string): string {
  const root = mkdtempSync(join(tmpdir(), 'notes-'));
  temps.push(root);
  mkdirSync(join(root, dirName));
  const notes = join(root, dirName, 'v1.0.0.md');
  writeFileSync(notes, '### Fixes\n\n- **main:** a fix (devstation-cd34)\n');
  return notes;
}

describe('builderArgs', () => {
  it('passes the release notes file to electron-builder as releaseInfo.releaseNotesFile', () => {
    const notes = createNotes('notes');

    expect(builderArgs({ ...base, releaseNotes: notes })).toEqual([
      '--win',
      'nsis',
      'msi',
      '--x64',
      '--publish',
      'always',
      '--config',
      'electron-builder.config.ts',
      '--config.npmRebuild=false',
      `--config.releaseInfo.releaseNotesFile=${resolve(notes)}`,
    ]);
  });

  it('passes a notes path a shell would read ($, %, backtick, space) as one argument, unchanged', () => {
    const notes = createNotes('a $b %c% `d');

    const args = builderArgs({ ...base, releaseNotes: notes });

    expect(args.at(-1)).toBe(`--config.releaseInfo.releaseNotesFile=${resolve(notes)}`);
  });

  it('splits targets on any run of whitespace, with no empty arguments', () => {
    const args = builderArgs({ ...base, targets: '  nsis   msi ' });

    expect(args.slice(0, 4)).toEqual(['--win', 'nsis', 'msi', '--x64']);
  });

  it('builds without release notes when none are given', () => {
    expect(builderArgs(base).some((arg) => arg.includes('releaseNotesFile'))).toBe(false);
  });

  it('refuses a release notes file that does not exist', () => {
    expect(() =>
      builderArgs({ ...base, releaseNotes: join(tmpdir(), 'no-such-notes.md') })
    ).toThrow('release notes file not found');
  });
});

describe('electronBuilderCli', () => {
  it("is electron-builder's cli.js, run by node itself, not through a shell", () => {
    const cli = electronBuilderCli();

    expect(basename(cli)).toBe('cli.js');
    expect(cli).toContain('electron-builder');
    expect(existsSync(cli)).toBe(true);
  });
});
