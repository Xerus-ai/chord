import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (process.env.CI || process.env.CHORD_SKIP_ELECTRON_REBUILD === '1') {
  process.exit(0);
}

function getElectronRebuildBin() {
  const binName = process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild';

  return path.resolve(__dirname, '..', 'node_modules', '.bin', binName);
}

function runElectronRebuild(onlyModules) {
  const electronRebuildBin = getElectronRebuildBin();
  const args = ['-f'];

  if (onlyModules && onlyModules.length > 0) {
    args.push('--only', onlyModules.join(','));
  }

  // node-pty's winpty.gyp runs `cd shared && GetCommitHash.bat`, which needs cmd
  // to search the current directory. Agent and CI shells set
  // NoDefaultCurrentDirectoryInExePath=1, which disables that and breaks the
  // rebuild, so the child build never sees it.
  const env = { ...process.env };
  delete env.NoDefaultCurrentDirectoryInExePath;

  const result =
    process.platform === 'win32'
      ? spawnSync(electronRebuildBin, args, { stdio: 'inherit', shell: true, env })
      : spawnSync(electronRebuildBin, args, { stdio: 'inherit', env });

  if (result.error) {
    console.error('postinstall: failed to run electron-rebuild:', result.error);
  }

  if (result.status === 0) return;
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

const disablePty = process.env.CHORD_DISABLE_PTY === '1';
const disableNativeDb = process.env.CHORD_DISABLE_NATIVE_DB === '1';

const nativeModules: string[] = [];
if (!disableNativeDb) nativeModules.push('better-sqlite3');
if (!disablePty) nativeModules.push('node-pty');

if (nativeModules.length === 0) {
  process.exit(0);
}

runElectronRebuild(nativeModules);
