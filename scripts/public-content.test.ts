import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * The repository is public (devstation-ewwz): the tracked tree names no private plan, no
 * maintainer's personal data, no domain the project does not own, and no product whose design
 * it took cues from (devstation-7orh). Applied migrations are
 * checksum-locked (server/src/db/migration-files.ts) and drizzle/ is generated, so neither is read.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SELF = relative(ROOT, fileURLToPath(import.meta.url)).replace(/\\/g, '/');
const LOCKED = [/^server\/src\/db\/migrations\/.*\.sql$/, /^drizzle\/.*\.sql$/];

const RULES: { name: string; pattern: RegExp }[] = [
  {
    name: 'private plan path or plan file',
    pattern:
      /\.context\/plans\/|docs\/plans\/|chord-internal\/|\d{4}-\d{2}-\d{2}-[a-z0-9-]+-(?:plan|design)\.md/,
  },
  { name: "maintainer's full name or résumé fixture", pattern: /patnecha|raghav-resume/i },
  { name: 'domain the project does not own', pattern: /\bchord\.(?:dev|sh)\b/ },
  // devstation-7orh: the products whose designs were references, not credits. `.conductor`
  // (a folder the file watcher ignores) and Chord's own open-artifacts-only names stay.
  {
    name: 'product the design took cues from',
    pattern: /\b(?:orca|paseo)\b|(?<![.\w])conductor\b|\bopen-artifacts\b(?!-only)|coda0hq/i,
  },
];

const DELETED = [
  'testing/byoi/',
  'flake.nix',
  'flake.lock',
  'server/package-lock.json',
  'screenshots/README.md',
  'scripts/sidebar-parity-check.mjs',
];

const tracked = execFileSync('git', ['ls-files', '-z'], { cwd: ROOT, encoding: 'utf8' })
  .split('\0')
  .filter((file) => file !== '' && file !== SELF && !LOCKED.some((p) => p.test(file)));

/** Each tracked text file's lines; binary files (a NUL byte) are skipped. */
function readTrackedText(): { file: string; lines: string[] }[] {
  return tracked.flatMap((file) => {
    const body = readFileSync(join(ROOT, file));
    return body.includes(0) ? [] : [{ file, lines: body.toString('utf8').split('\n') }];
  });
}

describe('the public tree', () => {
  const texts = readTrackedText();

  for (const rule of RULES) {
    it(`names no ${rule.name}`, () => {
      const hits = texts.flatMap(({ file, lines }) =>
        lines.flatMap((line, i) => (rule.pattern.test(line) ? [`${file}:${i + 1}`] : []))
      );
      expect(hits).toEqual([]);
    });
  }

  it('does not carry the dead files the publication audit found', () => {
    expect(tracked.filter((file) => DELETED.some((dead) => file.startsWith(dead)))).toEqual([]);
  });
});
