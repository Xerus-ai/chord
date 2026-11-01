import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';

export interface BuilderOptions {
  platform: 'mac' | 'linux' | 'win';
  targets: string;
  arch: string;
  config: string;
  /** The release's notes (changelog.ts --extract): the manifest's `releaseNotes` (F21). */
  releaseNotes?: string;
}

/** electron-builder's CLI script, run by node directly so no shell reads its arguments. */
export function electronBuilderCli(): string {
  return createRequire(import.meta.url).resolve('electron-builder/cli.js');
}

/** The electron-builder arguments for one platform and arch. */
export function builderArgs(options: BuilderOptions): string[] {
  const args = [
    `--${options.platform}`,
    ...options.targets.split(/\s+/).filter((target) => target !== ''),
    `--${options.arch}`,
    '--publish',
    'always',
    '--config',
    options.config,
    '--config.npmRebuild=false',
  ];
  if (options.releaseNotes !== undefined) {
    const notes = resolve(options.releaseNotes);
    if (!existsSync(notes)) throw new Error(`release notes file not found: ${notes}`);
    args.push(`--config.releaseInfo.releaseNotesFile=${notes}`);
  }
  return args;
}
