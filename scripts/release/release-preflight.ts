import { appendFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { readCiRan } from './lib/ci-ran.ts';
import { readDeployedTag } from './lib/deployed-tag.ts';
import { fail, info } from './lib/log.ts';
import { formatReleaseOutputs, readReleaseDecision } from './lib/release-preflight.ts';

/**
 * release.yml's preflight (devstation-pqub, C4): decides whether the CI-green commit `--sha`
 * is a release, a rerun of one, or neither, and writes the decision to $GITHUB_OUTPUT (or
 * prints it when that is unset). A release that fails a check ends with exit 1, naming it.
 * `--health-url` is the live sync server's /health, read only for a release: the tag it runs
 * starts the server range and the migration lint. GITHUB_REPOSITORY and GH_TOKEN (actions: read)
 * let it ask whether CI ran on the merge that moved an untagged version a later commit names.
 *
 *   node --experimental-strip-types scripts/release/release-preflight.ts --sha <commit> \
 *     --health-url <https://api.../health>
 */
const { values } = parseArgs({
  options: { sha: { type: 'string' }, 'health-url': { type: 'string' } },
  strict: true,
});
const healthUrl = values['health-url'];
if (!values.sha || !healthUrl) {
  fail('Usage: release-preflight.ts --sha <commit> --health-url <url>');
}
const repo = process.env.GITHUB_REPOSITORY;
const token = process.env.GH_TOKEN;
if (!repo || !token) fail('release-preflight.ts needs GITHUB_REPOSITORY and GH_TOKEN');

let decision;
try {
  decision = await readReleaseDecision(
    process.cwd(),
    values.sha,
    async () => {
      const deployed = await readDeployedTag(healthUrl);
      info(`the server runs ${deployed ?? 'no release'}`);
      return deployed;
    },
    async (merge) => {
      const ran = await readCiRan(repo, token, merge);
      info(`CI ${ran ? 'ran' : 'never ran'} on ${merge}`);
      return ran;
    }
  );
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
