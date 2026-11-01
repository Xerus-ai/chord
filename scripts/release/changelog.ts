import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { parseArgs } from 'node:util';
import { buildSection, extractSection, insertSection, readRangeSubjects } from './lib/changelog.ts';
import { fail, info } from './lib/log.ts';

const USAGE = [
  'Usage:',
  '  changelog.ts --from <ref> --version vX.Y.Z [--to <ref>] [--date YYYY-MM-DD]',
  '      writes the section for <from>..<to> into CHANGELOG.md',
  '  changelog.ts --extract vX.Y.Z --out <file>',
  '      writes that version section as release notes',
].join('\n');

const { values } = parseArgs({
  options: {
    from: { type: 'string' },
    to: { type: 'string', default: 'HEAD' },
    version: { type: 'string' },
    date: { type: 'string', default: new Date().toISOString().slice(0, 10) },
    extract: { type: 'string' },
    out: { type: 'string' },
  },
  strict: true,
});

const CHANGELOG = 'CHANGELOG.md';

if (values.extract) {
  if (!values.out) fail(USAGE);
  mkdirSync(dirname(values.out), { recursive: true });
  writeFileSync(values.out, extractSection(readFileSync(CHANGELOG, 'utf8'), values.extract));
  info(`Wrote the ${values.extract} release notes to ${values.out}`);
} else {
  if (!values.from || !values.version) fail(USAGE);
  const section = buildSection(
    values.version,
    values.date,
    readRangeSubjects(values.from, values.to, process.cwd())
  );
  const current = existsSync(CHANGELOG) ? readFileSync(CHANGELOG, 'utf8') : null;
  writeFileSync(CHANGELOG, insertSection(current, section));
  info(`Added ${values.version} to ${CHANGELOG}`);
}
