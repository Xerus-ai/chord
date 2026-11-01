/**
 * Builds the app into an e2e root of its own (default `.e2e-app/`): the
 * electron-vite output under `<root>/out` plus the repo's package.json, which
 * is what Electron needs to run `<root>` as an app (main reads
 * `app.getAppPath()/out/...` and `app.getAppPath()/package.json`). Probes
 * launch it with `launchSeededApp({ source: 'built', appDir })` or
 * `CHORD_E2E_APP_DIR`, so they never share `out/` with `pnpm run dev`.
 *
 *   node scripts/e2e/build-e2e-app.mjs [root]
 */
import { execSync } from 'node:child_process';
import { copyFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ROOT } from './seeded-app.mjs';

const appDir = resolve(ROOT, process.argv[2] ?? '.e2e-app');
mkdirSync(appDir, { recursive: true });
execSync(`pnpm exec electron-vite build --outDir "${join(appDir, 'out')}"`, {
  cwd: ROOT,
  stdio: 'inherit',
});
copyFileSync(join(ROOT, 'package.json'), join(appDir, 'package.json'));
console.log(`e2e app built at ${appDir}`);
