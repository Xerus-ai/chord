import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Since Electron 42 the `electron` package has no postinstall script of its own: its binary
 * arrives only when something runs its `install.js` (the `install-electron` bin). Run it here,
 * before the CI early exit below, so every install (CI included) leaves a runnable binary.
 */
function installElectronBinary() {
  const installScript = createRequire(import.meta.url).resolve('electron/install.js');
  const result = spawnSync(process.execPath, [installScript], { stdio: 'inherit' });
  if (result.error) {
    console.error('postinstall: failed to run electron/install.js:', result.error);
  }
  if (result.status === 0) return;
  process.exit(typeof result.status === 'number' ? result.status : 1);
}

installElectronBinary();

if (process.env.CI || process.env.CHORD_SKIP_ELECTRON_REBUILD === '1') {
  process.exit(0);
}

function getElectronRebuildBin() {
  const binName = process.platform === 'win32' ? 'electron-rebuild.cmd' : 'electron-rebuild';

  return path.resolve(__dirname, '..', 'node_modules', '.bin', binName);
}

function runElectronRebuild(onlyModules: string[]) {
  const electronRebuildBin = getElectronRebuildBin();
  const args = ['-f', '--only', onlyModules.join(',')];

  // node-pty's winpty.gyp runs `cd shared && GetCommitHash.bat`, which needs cmd
  // to search the current directory. Agent and CI shells set
  // NoDefaultCurrentDirectoryInExePath=1, which disables that and breaks the
  // rebuild, so the child build never sees it. Windows env names are
  // case-insensitive and a shell can pass it in any case, so match ignoring case.
  const env = { ...process.env };
  for (const name of Object.keys(env)) {
    if (name.toLowerCase() === 'nodefaultcurrentdirectoryinexepath') delete env[name];
  }

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

// node-pty is the one native module built for Electron's ABI: better-sqlite3 13 is N-API and
// loads the prebuild it ships.
if (process.env.CHORD_DISABLE_PTY !== '1') {
  runElectronRebuild(['node-pty']);
}
