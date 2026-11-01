/**
 * Measures the right rail's rows against the left sidebar's, which is the
 * whole claim of the redesign's stage 2: one scanned-list type tier and one
 * selection treatment, shared rather than copied.
 *
 * Reads getComputedStyle off the real nodes — a screenshot cannot settle
 * whether 13px is 13px, and the two surfaces sit at different widths. Run:
 * `pnpm run build && node scripts/rail-parity-check.mjs`
 */
/* global document, getComputedStyle -- the evaluate() body runs in the renderer, not here. */
import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { _electron as electron } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const outDir = resolve(root, 'screenshots', 'rail-redesign');
mkdirSync(outDir, { recursive: true });

/** What stage 2 promises, from the plan's receipts line. */
const EXPECTED = {
  'rail row title': '13px',
  'rail row meta': '11px',
  'rail section label': '11px uppercase',
};

async function main() {
  const app = await electron.launch({
    args: ['.', '--no-sandbox'],
    cwd: root,
    timeout: 120000,
    env: { ...process.env, CHORD_DISABLE_PTY: '1' },
  });

  const window = await app.firstWindow({ timeout: 120000 });
  await window.waitForLoadState('domcontentloaded');
  await window.waitForTimeout(8000);

  // A fresh profile opens on the setup screen, which owns the whole window —
  // there is no sidebar behind it to measure until it is dismissed.
  const getStarted = window.getByText('Get started', { exact: true });
  if (await getStarted.count()) {
    await getStarted.click();
    await window.waitForTimeout(4000);
  }
  await window.waitForSelector('.bg-surface-sidebar', { timeout: 60000 });
  await window.waitForTimeout(2000);

  const rows = window.locator('[data-sidebar-row]');
  if ((await rows.count()) === 0) {
    console.log('NO WORK ITEMS — the rail cannot be measured from this state.');
    await window.screenshot({ path: resolve(outDir, 'empty-state.png') });
    await app.close();
    process.exit(2);
  }
  await rows.first().click();
  await window.waitForTimeout(6000);

  const tabs = window.locator('[role="tab"]');
  console.log(`rail tabs: ${await tabs.count()}`);
  if ((await tabs.count()) === 0) {
    console.log('RAIL CLOSED — open it and re-run.');
    await window.screenshot({ path: resolve(outDir, 'rail-closed.png') });
    await app.close();
    process.exit(2);
  }

  const measured = await window.evaluate(() => {
    const read = (el) => {
      if (!el) return null;
      const s = getComputedStyle(el);
      return {
        text: (el.textContent ?? '').trim().slice(0, 24),
        fontSize: s.fontSize,
        fontWeight: s.fontWeight,
        letterSpacing: s.letterSpacing,
        textTransform: s.textTransform,
        borderColor: s.borderTopColor,
        background: s.backgroundColor,
      };
    };
    const panel = document.querySelector('[role="tabpanel"]');
    const railRow = panel?.querySelector('.list-card');
    const sidebarCard = document.querySelector('[data-sidebar-row] .list-card, .list-card');
    return {
      'rail row title': read(railRow?.querySelector('.text-list-row')),
      'rail row meta': read(railRow?.querySelector('.text-list-meta')),
      'rail section label': read(panel?.querySelector('.uppercase.text-list-meta')),
      'rail row card': read(railRow),
      'sidebar card': read(sidebarCard),
    };
  });

  console.log('\nelement'.padEnd(22), 'measured'.padEnd(30), 'expected');
  for (const [key, want] of Object.entries(EXPECTED)) {
    const got = measured[key];
    const shown = got
      ? `${got.fontSize} / ${got.fontWeight} ${got.textTransform === 'uppercase' ? 'uppercase' : ''}`
      : 'NOT FOUND';
    console.log(key.padEnd(22), shown.padEnd(30), want);
  }
  console.log('\nfull:', JSON.stringify(measured, null, 2));

  await window.screenshot({ path: resolve(outDir, 'rail.png') });

  // One frame per tab: the band is the same row in all four, which is the
  // claim worth a picture.
  for (const label of ['Work item', 'Files', 'Checks']) {
    const tab = window.locator('[role="tab"]', { hasText: label });
    if ((await tab.count()) === 0) {
      console.log(`tab not found: ${label}`);
      continue;
    }
    await tab.last().click();
    await window.waitForTimeout(1500);
    await window.screenshot({ path: resolve(outDir, `tab-${label.replace(/ /g, '-')}.png`) });
  }

  console.log(`\nsaved to ${outDir}`);
  await app.close();
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
