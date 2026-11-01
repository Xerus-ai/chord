/**
 * Captures the left sidebar in each state the approved prototype defines, so a
 * stage can be compared against the approved prototype (`sidebar-redesign.html`
 * in the design prototypes) before it is committed:
 * Repos tab, Status tab, an opened work item, and the options popover.
 *
 * Needs a production build in `out/` (`pnpm run build`): the dev build cannot be
 * launched directly.
 * Run: `node scripts/sidebar-redesign-shots.mjs`
 */
/* global document -- the waitForFunction() body runs in the renderer, not here. */
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { _electron as electron } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'screenshots', 'sidebar-redesign');
mkdirSync(outDir, { recursive: true });

async function main() {
  const app = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: root,
    timeout: 120000,
    env: { ...process.env, CHORD_DISABLE_PTY: '1' },
  });

  const window = await app.firstWindow({ timeout: 120000 });
  await window.waitForLoadState('domcontentloaded');

  // The onboarding flag is per account AND per origin, and this production
  // build (`app://`) does not share the dev server's localStorage — so a
  // signed-in account that finished onboarding in dev meets it again here.
  // Finish it the way a user does: wait out the agent scan, press the button.
  const getStarted = window.getByRole('button', { name: 'Get started' });
  const sidebarOrOnboarding = await Promise.race([
    window.waitForSelector('.bg-surface-sidebar', { timeout: 60000 }).then(() => 'sidebar'),
    getStarted.waitFor({ timeout: 60000 }).then(() => 'onboarding'),
  ]);
  if (sidebarOrOnboarding === 'onboarding') {
    await window.waitForFunction(
      () =>
        [...document.querySelectorAll('button')].some(
          (b) => b.textContent?.trim() === 'Get started' && !b.disabled
        ),
      undefined,
      { timeout: 120000 }
    );
    await getStarted.click();
    // Onboarding lands on the dashboard; the sidebar is part of that shell.
  }
  await window.waitForSelector('.bg-surface-sidebar', { timeout: 60000 });
  await window.waitForTimeout(4000);

  const sidebar = window.locator('.bg-surface-sidebar').first();
  const shoot = (name) => sidebar.screenshot({ path: resolve(outDir, `${name}.png`) });

  await window.getByRole('tab', { name: 'Repos' }).click();
  await window.waitForTimeout(500);
  console.log(`repos tab rows: ${await window.locator('[data-sidebar-row]').count()}`);
  await shoot('repos');

  await window.locator('[data-sidebar-row]').first().click();
  await window.waitForTimeout(3000);
  await shoot('repos-item-open');

  await window.getByRole('tab', { name: 'Status' }).click();
  await window.waitForTimeout(500);
  console.log(`status tab rows: ${await window.locator('[data-sidebar-row]').count()}`);
  await shoot('status');

  // The hover card opens beside the sidebar, so it needs the whole window.
  // Park the pointer on a row and wait out the card's open delay.
  await window.locator('[data-sidebar-row]').nth(2).hover();
  await window.waitForTimeout(1200);
  await window.screenshot({ path: resolve(outDir, 'hover-card.png') });
  await window.mouse.move(900, 500);
  await window.waitForTimeout(600);

  await window.getByRole('button', { name: 'Sidebar options' }).click();
  await window.waitForTimeout(500);
  await window.screenshot({ path: resolve(outDir, 'options.png') });

  await window.getByRole('button', { name: /Sort by/ }).click();
  await window.waitForTimeout(400);
  await window.screenshot({ path: resolve(outDir, 'options-sort-by.png') });
  // Escape backs out of the drill-in view first, then closes the popover.
  await window.keyboard.press('Escape');
  await window.keyboard.press('Escape');
  await window.getByText('Display options').waitFor({ state: 'hidden', timeout: 5000 });

  // The repo header's menu and its icon picker. Looked at, never picked from:
  // this runs against the user's real database, and a capture must not leave
  // their repos wearing icons they did not choose.
  await window.getByRole('tab', { name: 'Repos' }).click();
  await window.waitForTimeout(500);
  // The `···` button only exists while its header is hovered.
  await window.locator('[data-sidebar-group-header]').first().hover();
  await window.waitForTimeout(300);
  await shoot('repo-header-hover');
  await window
    .locator('[data-sidebar-group-header]')
    .first()
    .getByRole('button', { name: / options$/ })
    .click();
  await window.waitForTimeout(400);
  await window.screenshot({ path: resolve(outDir, 'repo-menu.png') });
  await window.getByText('Change icon').hover();
  await window.waitForTimeout(600);
  await window.screenshot({ path: resolve(outDir, 'repo-icon-picker.png') });
  await window.keyboard.press('Escape');

  await app.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
