/* global document, Image */
/**
 * Compares two UI identity captures (`ui-identity.mjs`, devstation-7orh): every
 * state's root custom properties, every rendered element's box and computed
 * style (matched by DOM path), and the window screenshots, byte for byte and,
 * where the bytes differ, pixel by pixel with the bounding box of the change.
 * Exits 1 on any difference and names each one.
 *
 *   node scripts/e2e/lib/ui-identity-compare.mjs <label-a> <label-b>
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { E2E_OUT_DIR, E2E_SHOTS_DIR } from './experience/run-record.mjs';

const [labelA, labelB] = process.argv.slice(2);
if (!labelA || !labelB) {
  throw new Error('Usage: node scripts/e2e/lib/ui-identity-compare.mjs <label-a> <label-b>');
}
const statesOf = (label) =>
  readdirSync(join(E2E_OUT_DIR, 'ui-identity', label))
    .filter((name) => name.endsWith('.json'))
    .sort();

/** The newest screenshot of a label's state (a label may have been captured more than once). */
function screenshotOf(label, state) {
  const prefix = `ui-identity-${label}-${state.replace(/\.json$/, '')}`;
  const matches = readdirSync(E2E_SHOTS_DIR).filter((name) => name === `${prefix}.png`);
  if (matches.length !== 1) throw new Error(`no screenshot ${prefix}.png in ${E2E_SHOTS_DIR}`);
  return join(E2E_SHOTS_DIR, matches[0]);
}

function compareRecords(a, b) {
  const differences = [];
  for (const name of new Set([...Object.keys(a.rootTokens), ...Object.keys(b.rootTokens)])) {
    if (a.rootTokens[name] !== b.rootTokens[name]) {
      differences.push(`token ${name}: ${a.rootTokens[name]} | ${b.rootTokens[name]}`);
    }
  }
  const byPath = (elements) => new Map(elements.map((element) => [element.path, element]));
  const mapA = byPath(a.elements);
  const mapB = byPath(b.elements);
  for (const path of new Set([...mapA.keys(), ...mapB.keys()])) {
    const ea = mapA.get(path);
    const eb = mapB.get(path);
    if (!ea || !eb) {
      differences.push(`element ${path}: only in ${ea ? labelA : labelB}`);
      continue;
    }
    if (ea.className !== eb.className) {
      differences.push(`class ${path}: "${ea.className}" | "${eb.className}"`);
    }
    if (ea.box.join() !== eb.box.join()) differences.push(`box ${path}: ${ea.box} | ${eb.box}`);
    for (const property of Object.keys(ea.style)) {
      if (ea.style[property] !== eb.style[property]) {
        differences.push(
          `style ${path} ${property}: ${ea.style[property]} | ${eb.style[property]}`
        );
      }
    }
  }
  return differences;
}

/** Pixels that differ between two PNGs, and the box around them, decoded in Chromium. */
async function comparePixels(browser, fileA, fileB) {
  const page = await browser.newPage();
  try {
    const toDataUrl = (file) => `data:image/png;base64,${readFileSync(file).toString('base64')}`;
    return await page.evaluate(
      async ([srcA, srcB]) => {
        const load = (src) =>
          new Promise((resolve, reject) => {
            const image = new Image();
            image.onload = () => resolve(image);
            image.onerror = reject;
            image.src = src;
          });
        const [imageA, imageB] = await Promise.all([load(srcA), load(srcB)]);
        if (imageA.width !== imageB.width || imageA.height !== imageB.height) {
          return { size: `${imageA.width}x${imageA.height} | ${imageB.width}x${imageB.height}` };
        }
        const pixels = (image) => {
          const canvas = document.createElement('canvas');
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext('2d');
          context.drawImage(image, 0, 0);
          return context.getImageData(0, 0, image.width, image.height).data;
        };
        const [pa, pb] = [pixels(imageA), pixels(imageB)];
        let count = 0;
        let box = null;
        for (let i = 0; i < pa.length; i += 4) {
          if (
            pa[i] === pb[i] &&
            pa[i + 1] === pb[i + 1] &&
            pa[i + 2] === pb[i + 2] &&
            pa[i + 3] === pb[i + 3]
          )
            continue;
          count += 1;
          const x = (i / 4) % imageA.width;
          const y = Math.floor(i / 4 / imageA.width);
          box = box
            ? [Math.min(box[0], x), Math.min(box[1], y), Math.max(box[2], x), Math.max(box[3], y)]
            : [x, y, x, y];
        }
        return { count, box };
      },
      [toDataUrl(fileA), toDataUrl(fileB)]
    );
  } finally {
    await page.close();
  }
}

const statesA = statesOf(labelA);
const statesB = statesOf(labelB);
if (statesA.join() !== statesB.join()) {
  throw new Error(`the captures hold different states: ${statesA} | ${statesB}`);
}

const browser = await chromium.launch();
let failed = false;
try {
  for (const state of statesA) {
    const read = (label) =>
      JSON.parse(readFileSync(join(E2E_OUT_DIR, 'ui-identity', label, state), 'utf8'));
    const a = read(labelA);
    const b = read(labelB);
    const differences = compareRecords(a, b);
    const [shotA, shotB] = [screenshotOf(labelA, state), screenshotOf(labelB, state)];
    const sameBytes = readFileSync(shotA).equals(readFileSync(shotB));
    const pixels = sameBytes ? { count: 0, box: null } : await comparePixels(browser, shotA, shotB);
    const identical = differences.length === 0 && pixels.count === 0 && !pixels.size;
    failed ||= !identical;
    console.log(
      `${identical ? 'SAME' : 'DIFF'}  ${state}: ${a.elements.length} elements, ` +
        `${Object.keys(a.rootTokens).length} tokens, ${differences.length} style differences, ` +
        `screenshot ${sameBytes ? 'byte-equal' : `${pixels.size ?? `${pixels.count} pixels differ in ${pixels.box}`}`}`
    );
    for (const line of differences.slice(0, 40)) console.log(`      ${line}`);
    if (differences.length > 40) console.log(`      … ${differences.length - 40} more`);
  }
} finally {
  await browser.close();
}
console.log(
  failed ? `FAIL  ${labelA} and ${labelB} differ` : `PASS  ${labelA} and ${labelB} are identical`
);
process.exitCode = failed ? 1 : 0;
