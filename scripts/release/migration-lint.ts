import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { fail, info } from './lib/log.ts';
import { lintMigrations, MIGRATION_LINT_BASELINE } from './lib/migration-lint.ts';

/**
 * Release preflight's migration lint (design C5, F8; devstation-5s42): a migration
 * that would break the release still serving during a deploy needs a
 * '-- contract-for: vX.Y.Z' header naming a released tag. Exit 0 when clean.
 *
 *   node --experimental-strip-types scripts/release/migration-lint.ts [--since <previous tag>]
 *
 * --since lints only the files the previous release did not have; without it,
 * the files above MIGRATION_LINT_BASELINE (the set that shipped before the lint).
 */
const DIR = 'server/src/db/migrations';

const { values } = parseArgs({
  options: { since: { type: 'string' } },
  strict: true,
});

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' }).trim();
const releasedTags = git('tag', '--list', 'v*').split('\n').filter(Boolean);

const names = readdirSync(DIR)
  .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n))
  .sort();
let after = MIGRATION_LINT_BASELINE;
if (values.since) {
  if (!releasedTags.includes(values.since)) fail(`--since ${values.since} is not a release tag`);
  const shipped = git('ls-tree', '--name-only', `${values.since}:${DIR}`)
    .split('\n')
    .filter((n) => /^\d{4}_/.test(n))
    .map((n) => Number(n.slice(0, 4)));
  after = shipped.length ? Math.max(...shipped) : -1;
}

const findings = lintMigrations(
  names.map((name) => ({ name, sql: readFileSync(join(DIR, name), 'utf8') })),
  { releasedTags, after }
);
for (const f of findings) info(`FAIL  ${f.file}: ${f.reason}\n        ${f.statement}`);
if (findings.length) fail(`${findings.length} migration statement(s) would break the live release`);
info(`migrations after ${String(after).padStart(4, '0')} are safe for the live release`);
