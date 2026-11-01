import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { _electron as electron } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const ssDir = resolve(root, 'screenshots', 'smoke');
mkdirSync(ssDir, { recursive: true });

async function main() {
  console.log('Launching Electron via electron-vite...');

  const app = await electron.launch({
    executablePath: resolve(root, 'node_modules/.bin/electron-vite.cmd'),
    args: ['dev', '--no-sandbox'],
    cwd: root,
    timeout: 60000,
    env: {
      ...process.env,
      NODE_ENV: 'development',
      CHORD_DISABLE_NATIVE_DB: '1',
      CHORD_DISABLE_PTY: '1',
    },
  });

  console.log('Waiting for first window...');
  const window = await app.firstWindow({ timeout: 60000 });
  console.log('Window opened!');

  await window.waitForLoadState('domcontentloaded');
  console.log('DOM loaded, waiting 8s for render...');
  await window.waitForTimeout(8000);

  console.log('Taking screenshot 1: initial view');
  await window.screenshot({ path: resolve(ssDir, '01-initial.png') });

  // Try to click a work item
  try {
    const items = window.locator('[class*="cursor-pointer"][class*="rounded"]');
    const count = await items.count();
    console.log(`Found ${count} clickable items`);
    if (count > 0) {
      await items.first().click();
      await window.waitForTimeout(3000);
      console.log('Taking screenshot 2: item clicked');
      await window.screenshot({ path: resolve(ssDir, '02-item-clicked.png') });
    }
  } catch (e) {
    console.log('Item click failed:', e.message);
  }

  console.log('All screenshots saved to screenshots/smoke/');
  await app.close();
  console.log('Done!');
}

main().catch((err) => {
  console.error('Fatal:', err.message);
  process.exit(1);
});
