import { parseArgs } from 'node:util';
import { fail, info } from './lib/log.ts';
import { readReleasePlan, type ReleaseChannel } from './lib/release-plan.ts';

/**
 * Prints the next release's plan for the repository it runs in (devstation-g98j, C3): the last
 * stable tag, the tag to make, and the commits in between. `--json` prints only the plan as
 * JSON, which the release gate's notes phase reads. A commit that breaks the commit rule, or a
 * range that would need a major bump, ends it with exit 1, naming why. `--channel canary`, or
 * CHORD_RELEASE_CHANNEL=canary (so the gate's notes phase records a canary unchanged), plans the
 * next version's canary.
 */
const { values } = parseArgs({
  options: {
    json: { type: 'boolean', default: false },
    channel: { type: 'string', default: process.env.CHORD_RELEASE_CHANNEL || 'stable' },
  },
  strict: true,
});
if (values.channel !== 'stable' && values.channel !== 'canary') {
  fail(`the release channel is stable or canary, not '${values.channel}'`);
}

let plan;
try {
  plan = readReleasePlan(process.cwd(), values.channel as ReleaseChannel);
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

if (values.json) {
  console.log(JSON.stringify(plan));
} else {
  info(
    `next release: ${plan.tag} (${plan.commits.length} commits since ${plan.from ?? 'the start'})`
  );
  for (const commit of plan.commits) info(`${commit.sha.slice(0, 12)} ${commit.subject}`);
}
