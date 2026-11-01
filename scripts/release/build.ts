import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { builderArgs, electronBuilderCli, type BuilderOptions } from './lib/builder-command.ts';
import { exec, execFile } from './lib/exec.ts';
import { fail, info, step } from './lib/log.ts';

const { values } = parseArgs({
  options: {
    platform: { type: 'string' },
    arch: { type: 'string', default: 'both' },
    targets: { type: 'string' },
    config: { type: 'string', default: 'electron-builder.config.ts' },
    'release-notes': { type: 'string' },
  },
  strict: true,
});

const isPlatform = (p: string | undefined): p is BuilderOptions['platform'] =>
  p === 'mac' || p === 'linux' || p === 'win';
const platform = values.platform;
// Every build here publishes (--publish always), and a published manifest carries the
// release's notes (F21): changelog.ts --extract writes them.
const notesArg = values['release-notes'];
if (!isPlatform(platform) || !notesArg) {
  fail(
    'Usage: build.ts --platform mac|linux|win --release-notes <file> [--arch arm64|x64|both] [--targets dmg,zip] [--config electron-builder.config.ts]'
  );
}
// Checked before the first build step, not after an arch's native rebuild has run.
const releaseNotes = resolve(notesArg);
if (!existsSync(releaseNotes)) fail(`release notes file not found: ${releaseNotes}`);

const archInput = values.arch ?? 'both';
const archs: string[] = archInput === 'both' ? ['x64', 'arm64'] : [archInput];

const defaultTargets: Record<string, string> = {
  mac: 'dmg zip',
  linux: 'AppImage deb rpm',
  win: 'nsis msi',
};
const targets = values.targets ? values.targets.split(',').join(' ') : defaultTargets[platform];

for (const arch of archs) {
  step(`Building ${platform} ${targets} for ${arch}`);

  exec(`node --experimental-strip-types scripts/release/rebuild-native.ts --arch ${arch}`, {
    echo: true,
  });

  const args = builderArgs({
    platform,
    targets,
    arch,
    config: values.config,
    releaseNotes,
  });

  execFile(process.execPath, [electronBuilderCli(), ...args], { echo: true });
  info(`Built ${platform} ${targets} for ${arch}`);
}
