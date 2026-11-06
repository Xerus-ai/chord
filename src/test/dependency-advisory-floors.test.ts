import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The lockfile stays clear of the high and critical advisories the chord-deps loop raised and its
 * judgement fixed (devstation-2dgv.6, devstation-2dgv.9; pnpm audit 2026-11-06: 136 high, 9
 * critical). Each row is an advisory's vulnerable range as pnpm audit reports it; no version the
 * lockfile resolves may fall inside one. A new advisory is the chord-deps loop's to raise, not this
 * table's. pnpm-lock.yaml is read as text: a resolved package is a `  name@version` key.
 */
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const lock = readFileSync(path.join(ROOT, 'pnpm-lock.yaml'), 'utf8').replace(/\r/g, '');
const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>;
};

const ADVISORIES: Array<[name: string, range: string, advisory: string]> = [
  ['dompurify', '<=3.4.16', 'GHSA-cg2g-xh64-v4q7, GHSA-mrv2-3pqr-j5jr'],
  ['protobufjs', '<=7.6.0', 'GHSA-xq3m-2v4x-88gg, GHSA-wcpc-wj8m-hjx6'],
  ['@modelcontextprotocol/sdk', '>=1.3.0 <1.32.0', 'GHSA-46jr-4wx8-v453, GHSA-22jm-h49p-29qw'],
  ['fast-uri', '>=3.0.0 <3.1.7', 'GHSA-qw65-cvwx-89v3'],
  ['zod', '<4.6.6', 'GHSA-mrhx-c7xc-m3w5'],
  ['smol-toml', '<=1.7.0', 'GHSA-7w5x-hrqm-74c2'],
  ['@tiptap/core', '>=3.7.0 <3.30.5', 'GHSA-j95f-988m-3j2f'],
  ['prosemirror-view', '<1.42.3', 'GHSA-c8x8-7fp4-3x9w'],
  ['lodash-es', '>=4.0.0 <=4.17.23', 'GHSA-r5fr-rjxr-66jc'],
  ['lodash', '>=4.0.0 <=4.17.23', 'GHSA-r5fr-rjxr-66jc'],
  ['toml', '<=5.0.0', 'GHSA-4qx8-w7c3-pj3p'],
  ['js-yaml', '>=3.0.0 <3.15.2', 'GHSA-2883-xcg3-v3hh'],
  ['js-yaml', '>=4.0.0 <4.3.2', 'GHSA-2883-xcg3-v3hh'],
  ['proxy-addr', '>=1.1.0 <2.0.8', 'GHSA-jqcg-44mw-7w3h'],
  ['body-parser', '>=2.0.0 <2.4.0', 'GHSA-27r3-jxmh-p828'],
  ['ws', '>=8.0.0 <8.21.0', 'GHSA-96hv-2xvq-fx4p'],
  ['@vitest/browser', '>=4.0.0 <4.1.10', 'GHSA-p63j-vcc4-9vmv'],
  ['undici', '>=7.0.0 <7.30.1', 'GHSA-2m5v-pch6-74hx'],
  ['vite', '<=6.4.3', 'GHSA-587h-7wmj-h5pm'],
  ['rollup', '>=4.0.0 <4.59.0', 'GHSA-mw96-cpmx-2vgc'],
  ['postcss', '<=8.5.17', 'GHSA-r28c-9q8g-f849'],
  ['shell-quote', '<=1.8.4', 'GHSA-w7jw-789q-3m8p, GHSA-395f-4hp3-45gv'],
];

type Version = [number, number, number];

function parse(version: string): Version {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
  if (!m) throw new Error(`not a version: ${version}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function compare(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i];
  return 0;
}

/** A space-separated conjunction of `>=`, `<` and `<=` bounds, as pnpm audit prints them. */
function inRange(version: string, range: string): boolean {
  const v = parse(version);
  return range.split(' ').every((bound) => {
    const m = /^(>=|<=|<)(.+)$/.exec(bound);
    if (!m) throw new Error(`unsupported bound ${bound} in ${range}`);
    const c = compare(v, parse(m[2]));
    return m[1] === '>=' ? c >= 0 : m[1] === '<=' ? c <= 0 : c < 0;
  });
}

/** Every version the lockfile resolves for a package (its `packages:` and `snapshots:` keys). */
function locked(name: string): string[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const key = new RegExp(`^  '?${escaped}@(\\d+\\.\\d+\\.\\d+[^(:'\\s]*)`, 'gm');
  return [...new Set([...lock.matchAll(key)].map((m) => m[1]))];
}

describe('locked dependencies clear the chord-deps advisories', () => {
  it('electron resolves to 40.10.6 and the rebuild script targets it', () => {
    expect(locked('electron')).toEqual(['40.10.6']);
    expect(pkg.scripts.rebuild).toMatch(/ -v 40\.10\.6 /);
  });

  it('no locked version falls in a high or critical advisory range the judgement fixes', () => {
    const hits = ADVISORIES.flatMap(([name, range, advisory]) =>
      locked(name)
        .filter((version) => inRange(version, range))
        .map((version) => `${name}@${version} (${range}: ${advisory})`)
    );
    expect(hits).toEqual([]);
  });
});
