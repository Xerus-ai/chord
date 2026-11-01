/* global window, document, getComputedStyle, CSSStyleRule, CSSGroupingRule -- page.evaluate callbacks run inside the app window */
/**
 * UI identity capture (devstation-7orh): a change that must not change the UI
 * (comments reworded, files rewritten from a spec) is proven by capturing the
 * same surfaces from two builds and comparing them (`ui-identity-compare.mjs`).
 *
 * For each state (the shell, a work item with its topbar, tabs and composer,
 * the right rail open, then the same in the light theme) this writes a window
 * screenshot to screenshots/e2e and, to screenshots/ui-identity/<label>/, the
 * computed style and box of every rendered element plus the value of every
 * custom property on the root. Animations, transitions, the caret and the
 * renderer's clock are frozen and the pointer is parked, so two captures of
 * one build are byte-equal.
 *
 *   node scripts/e2e/build-e2e-app.mjs .e2e-app-baseline
 *   CHORD_E2E_APP_DIR=.e2e-app-baseline node scripts/e2e/ui-identity.mjs baseline
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { E2E_SHOTS_DIR } from './experience/run-record.mjs';
import { launchSeededApp, ROOT } from './seeded-app.mjs';

const label = process.argv[2];
if (!label || !/^[a-z0-9-]+$/.test(label)) {
  throw new Error(
    'Usage: node scripts/e2e/ui-identity.mjs <label> (lower-case letters, digits, -)'
  );
}
const STATES_DIR = join(ROOT, 'screenshots', 'ui-identity', label);
mkdirSync(STATES_DIR, { recursive: true });
mkdirSync(E2E_SHOTS_DIR, { recursive: true });

const FREEZE_CSS =
  '*, *::before, *::after { animation: none !important; transition: none !important; ' +
  'caret-color: transparent !important; scroll-behavior: auto !important; }';
// The dashboard prints the time and a greeting and rows print relative ages, so
// two captures only match when the renderer reads one fixed instant.
const FROZEN_CLOCK = new Date('2026-11-01T09:30:00Z');
const WINDOW_SIZE = [1440, 900];

const STYLE_PROPERTIES = [
  'display',
  'position',
  'visibility',
  'flex-direction',
  'align-items',
  'justify-content',
  'gap',
  'margin',
  'padding',
  'border-width',
  'border-style',
  'border-color',
  'border-radius',
  'background-color',
  'background-image',
  'color',
  'fill',
  'stroke',
  'opacity',
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'line-height',
  'letter-spacing',
  'text-align',
  'text-transform',
  'text-decoration-line',
  'white-space',
  'text-overflow',
  'overflow',
  'box-shadow',
  'outline',
  'cursor',
  'z-index',
];

/** Every rendered element: its DOM path, classes, box and computed style. */
function readRenderedElements(properties) {
  const pathOf = (element) => {
    const parts = [];
    for (let node = element; node && node !== document.documentElement; node = node.parentElement) {
      const parent = node.parentElement;
      const index = parent ? [...parent.children].indexOf(node) : 0;
      parts.unshift(`${node.tagName.toLowerCase()}[${index}]`);
    }
    return parts.join('>');
  };
  const elements = [];
  for (const element of document.body.querySelectorAll('*')) {
    if (['SCRIPT', 'STYLE', 'LINK', 'META'].includes(element.tagName)) continue;
    const box = element.getBoundingClientRect();
    if (box.width === 0 && box.height === 0) continue;
    const computed = getComputedStyle(element);
    elements.push({
      path: pathOf(element),
      className: typeof element.className === 'string' ? element.className : '',
      box: [box.x, box.y, box.width, box.height].map((n) => Math.round(n * 100) / 100),
      style: Object.fromEntries(properties.map((p) => [p, computed.getPropertyValue(p)])),
    });
  }
  return elements;
}

/** Every custom property any stylesheet declares, as the root computes it. */
function readRootTokens() {
  const names = new Set();
  const visit = (rules) => {
    for (const rule of rules) {
      if (rule instanceof CSSStyleRule) {
        for (const name of rule.style) if (name.startsWith('--')) names.add(name);
      }
      if (rule instanceof CSSGroupingRule || rule.cssRules) visit(rule.cssRules ?? []);
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      visit(sheet.cssRules);
    } catch {
      // A cross-origin sheet hides its rules; the app ships none.
      throw new Error(`stylesheet ${sheet.href} cannot be read`);
    }
  }
  const computed = getComputedStyle(document.documentElement);
  return Object.fromEntries(
    [...names].sort().map((name) => [name, computed.getPropertyValue(name).trim()])
  );
}

const instance = await launchSeededApp({ source: 'built', profilePrefix: 'chord-e2e-ui-identity' });
const { app, page } = instance;
const captured = [];

async function capture(state) {
  // A pointer left on a clicked row keeps its hover actions shown: park it on
  // the window's bottom-right pixel, which no control covers.
  await page.mouse.move(WINDOW_SIZE[0] - 1, WINDOW_SIZE[1] - 1);
  await page.waitForTimeout(1200);
  const index = String(captured.length + 1).padStart(2, '0');
  await page.screenshot({
    path: join(E2E_SHOTS_DIR, `ui-identity-${label}-${index}-${state}.png`),
  });
  const record = {
    elements: await page.evaluate(readRenderedElements, STYLE_PROPERTIES),
    rootTokens: await page.evaluate(readRootTokens),
    theme: await page.evaluate(() => document.documentElement.className),
    viewport: await page.evaluate(() => [window.innerWidth, window.innerHeight]),
  };
  writeFileSync(join(STATES_DIR, `${index}-${state}.json`), `${JSON.stringify(record)}\n`);
  captured.push(state);
  console.log(
    `captured ${state}: ${record.elements.length} elements, ${Object.keys(record.rootTokens).length} tokens`
  );
}

try {
  await app.evaluate(({ BrowserWindow }, [width, height]) => {
    const [window] = BrowserWindow.getAllWindows();
    window.unmaximize();
    window.setContentSize(width, height);
    // The real cursor over the window would hover whatever it rests on; the
    // run's own (CDP) pointer events still reach the page.
    window.setIgnoreMouseEvents(true);
  }, WINDOW_SIZE);
  await app.context().clock.setFixedTime(FROZEN_CLOCK);
  await page.reload();
  await page.addStyleTag({ content: FREEZE_CSS });
  await page.waitForSelector('[data-sidebar-row]', { timeout: 60_000 });
  await capture('shell');

  await page.locator('[data-sidebar-row]').first().click();
  await page
    .getByRole('button', { name: /^(Show|Hide) right panel$/ })
    .waitFor({ timeout: 30_000 });
  const showRail = page.getByRole('button', { name: 'Show right panel' });
  if (await showRail.count()) {
    await capture('work-item-rail-closed');
    await showRail.click();
  } else {
    await page.getByRole('button', { name: 'Hide right panel' }).click();
    await capture('work-item-rail-closed');
    await page.getByRole('button', { name: 'Show right panel' }).click();
  }
  await capture('work-item-rail-open');

  await page.evaluate(() => {
    document.documentElement.classList.remove('chord-dark');
    document.documentElement.classList.add('chord-light');
  });
  await capture('work-item-rail-open-light');
  console.log(`PASS  captured ${captured.length} states for ${label}`);
} catch (error) {
  console.error(`FAIL  ${error instanceof Error ? error.stack : String(error)}`);
  process.exitCode = 1;
} finally {
  await instance.close();
}
