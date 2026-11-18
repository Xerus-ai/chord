import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { fail, info } from './lib/log.ts';
import { formatReleaseOutputs, readReleaseDecision } from './lib/release-preflight.ts';

/**
 * release.yml's preflight (devstation-pqub, C4): decides whether the CI-green commit `--sha`
 * is a release, a rerun of one, or neither, and writes the decision to $GITHUB_OUTPUT (or
 * prints it when that is unset). A release that fails a check ends with exit 1, naming it.
 *
 *   node --experimental-strip-types scripts/release/release-preflight.ts --sha <commit>
 */
const { values } = parseArgs({
  options: { sha: { type: 'string' } },
  strict: true,
});
if (!values.sha) fail('Usage: release-preflight.ts --sha <commit>');

let decision;
try {
  decision = readReleaseDecision(process.cwd(), values.sha);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

const outputs = formatReleaseOutputs(decision);
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
if (!decision.release) {
  info(`not a release: ${decision.reason}`);
} else {
  info(`${decision.rerun ? 'rerun of' : 'release'} ${decision.tag}`);
  for (const line of outputs.trim().split('\n')) info(line);
}
