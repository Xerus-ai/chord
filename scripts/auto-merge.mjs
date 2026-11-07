#!/usr/bin/env node
// Whether GitHub may merge a PR by itself (devstation-4x42.57). The auto-merge workflow writes the
// PR (`gh pr view --json number,state,isDraft,headRefOid,baseRefName,autoMergeRequest,changedFiles`),
// its files (`gh api --paginate .../pulls/<n>/files`, one JSON object a line), the head's statuses
// (`gh api --paginate .../commits/<sha>/statuses`, one JSON object a line, each with its creator)
// and its check runs (`.../check-runs`) to files; this prints one JSON line {action, reason}:
//   enable   auto-merge is off, and the PR is open into the base at this head, every check run
//            succeeded, the verifier's status is success, and the risk tier is low (or high with
//            the permit agent's status success)
//   disable  auto-merge is on and something blocks: a failed check, a failed verdict, a high tier
//            without a permit
//   none     nothing to do now, with why (a check still runs, a status is missing, already on)
// The tier is the stricter of two: the `risk-tier` status the harness posts (`low` or
// `high: <why>`), and the one computed here from the PR's files against `--tiers`, the default
// branch's .github/risk-tiers.json, since the agents hold the token that posts statuses. A file
// list GitHub cut short (fewer files than changedFiles) or could not give is high. Bad input
// exits 2, so nothing is enabled.
// The verifier's and the permit's statuses count only from `--trusted-creator`, the login GitHub
// gives the chord-verifier App's statuses (`chord-verifier[bot]`, devstation-4x42.248): the agents'
// token can post any context, so a status of those contexts from any other identity is absent.
// The tier's status needs no such trust: it can only make the computed tier stricter.
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const PASSED = new Set(['success', 'neutral', 'skipped']);

function fail(message) {
  process.stderr.write(`auto-merge: ${message}\n`);
  process.exit(2);
}

function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    return fail(`cannot read ${file}: ${error.message}`);
  }
}

/** The head's statuses (one JSON object a line, as `gh api --paginate --jq '.[]'` prints them). */
function readStatuses(file) {
  try {
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch (error) {
    return fail(`cannot read ${file}: ${error.message}`);
  }
}

/** context -> the newest status of it, where a guarded context (verifier, permit) counts only a
 *  status whose creator is the trusted login (devstation-4x42.248). Newest is the highest id:
 *  GitHub numbers statuses in the order they are created. */
export function latestStatuses(list, trusted, guarded) {
  const out = new Map();
  for (const s of list) {
    if (typeof s?.context !== 'string' || typeof s?.state !== 'string' || !Number.isInteger(s?.id))
      throw new Error(`a status without context, state or id: ${JSON.stringify(s)}`);
    if (guarded.includes(s.context) && s.creator?.login !== trusted) continue;
    const seen = out.get(s.context);
    if (!seen || s.id > seen.id) out.set(s.context, s);
  }
  return out;
}

/** The PR's files, or null when the workflow could not list them (no file, or a line not JSON). */
function readFiles(file) {
  if (!existsSync(file)) return null;
  try {
    const lines = readFileSync(file, 'utf8').split('\n');
    return lines.filter((l) => l.trim()).map((l) => JSON.parse(l));
  } catch {
    return null;
  }
}

/** A risk-tiers.json glob as a regex, as the harness's risk_tier.py reads it: ** any folders,
 *  * within one folder, ? one character. */
function globRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; ) {
    if (glob.startsWith('**/', i)) [out, i] = [`${out}(?:.*/)?`, i + 3];
    else if (glob.startsWith('**', i)) [out, i] = [`${out}.*`, i + 2];
    else if (glob[i] === '*') [out, i] = [`${out}[^/]*`, i + 1];
    else if (glob[i] === '?') [out, i] = [`${out}[^/]`, i + 1];
    else [out, i] = [out + glob[i].replace(/[.+^${}()|[\]\\]/g, '\\$&'), i + 1];
  }
  return new RegExp(`^${out}$`);
}

/** Why the PR's own change is high tier; empty when it is low. */
export function computedTier(tiers, files, changedFiles) {
  if (files === null) return ['the file list could not be read'];
  const because = [];
  if (files.length < changedFiles)
    because.push(`the file list holds ${files.length} of ${changedFiles} changed files`);
  const paths = files.flatMap((f) => [f.filename, f.previous_filename].filter(Boolean));
  for (const glob of tiers.high_paths) {
    const re = globRegex(glob);
    const hit = paths.find((p) => re.test(p));
    if (hit) because.push(`${glob} matched ${hit}`);
  }
  const uncounted = tiers.uncounted.map(globRegex);
  const counted = files.filter((f) => !uncounted.some((re) => re.test(f.filename)));
  const lines = counted.reduce((n, f) => n + (Number(f.changes) || 0), 0);
  if (lines > tiers.max_changed_lines)
    because.push(
      `${lines} counted lines changed, more than max_changed_lines ${tiers.max_changed_lines}`
    );
  return because;
}

/** The latest run of each check name, without the workflow's own jobs. */
function latestRuns(runs, ignored) {
  const byName = new Map();
  for (const run of runs) {
    if (ignored.includes(run.name)) continue;
    const seen = byName.get(run.name);
    if (!seen || (run.id ?? 0) > (seen.id ?? 0)) byName.set(run.name, run);
  }
  return [...byName.values()];
}

/** { ok } | { block } | { wait }, each with why. */
function judge(pr, statuses, runs, computed, opts) {
  if (pr.state !== 'OPEN') return { wait: `the PR is ${String(pr.state).toLowerCase()}` };
  if (pr.isDraft) return { wait: 'the PR is a draft' };
  if (pr.baseRefName !== opts.base)
    return { wait: `the PR merges into ${pr.baseRefName}, not ${opts.base}` };
  if (pr.headRefOid !== opts.sha)
    return { wait: `the PR head moved to ${pr.headRefOid}; ${opts.sha} is not its head` };
  const latest = latestRuns(runs, opts.ignore);
  const failed = latest.find((r) => r.status === 'completed' && !PASSED.has(r.conclusion));
  if (failed) return { block: `check ${failed.name} is ${failed.conclusion}` };
  const verifier = statuses.get(opts.verifier);
  if (verifier && verifier.state !== 'success' && verifier.state !== 'pending')
    return { block: `${opts.verifier} is ${verifier.state}: ${verifier.description}` };
  const tier = statuses.get(opts.tier);
  if (!tier) return { wait: `no ${opts.tier} status on the head yet` };
  if (!verifier || verifier.state === 'pending')
    return { wait: `no ${opts.verifier} status on the head yet` };
  if (latest.length === 0) return { wait: 'no check run on the head yet' };
  const running = latest.find((r) => r.status !== 'completed');
  if (running) return { wait: `check ${running.name} is ${running.status}` };
  const posted = String(tier.description);
  const level = posted.split(':')[0].trim();
  if (level !== 'low' && level !== 'high')
    return { block: `${opts.tier} status reads '${posted}', neither low nor high` };
  const postedWhy = level === 'high' ? [posted.slice('high:'.length).trim() || 'posted high'] : [];
  const because = [...postedWhy, ...computed];
  if (because.length === 0) return { ok: 'low tier, every check green, verifier APPROVE' };
  if (statuses.get(opts.permit)?.state === 'success')
    return { ok: 'high tier with a permit, every check green, verifier APPROVE' };
  const why = because.join('; ');
  return {
    block: `high tier (${why}): waits for the permit agent's approval (status ${opts.permit})`,
  };
}

export function decide(pr, statusList, checks, computed, opts) {
  const statuses = latestStatuses(statusList, opts.trusted, [opts.verifier, opts.permit]);
  const verdict = judge(pr, statuses, checks.check_runs ?? [], computed, opts);
  const on = pr.autoMergeRequest != null;
  if (verdict.ok)
    return on
      ? { action: 'none', reason: `auto-merge is on: ${verdict.ok}` }
      : { action: 'enable', reason: verdict.ok };
  if (verdict.block) return { action: on ? 'disable' : 'none', reason: verdict.block };
  return { action: 'none', reason: verdict.wait };
}

function readTiers(file) {
  const tiers = readJson(file);
  const listed = (k) => Array.isArray(tiers[k]) && tiers[k].every((g) => typeof g === 'string');
  if (!listed('high_paths') || !listed('uncounted') || !Number.isInteger(tiers.max_changed_lines))
    fail(
      `${file} needs high_paths and uncounted (lists of globs) and max_changed_lines (a number)`
    );
  return tiers;
}

function main() {
  const { values } = parseArgs({
    options: {
      sha: { type: 'string' },
      pr: { type: 'string' },
      files: { type: 'string' },
      status: { type: 'string' },
      checks: { type: 'string' },
      tiers: { type: 'string' },
      base: { type: 'string' },
      'tier-context': { type: 'string' },
      'verifier-context': { type: 'string' },
      'permit-context': { type: 'string' },
      'trusted-creator': { type: 'string' },
      'ignore-check': { type: 'string', multiple: true, default: [] },
    },
  });
  const required = ['sha', 'pr', 'files', 'status', 'checks', 'tiers', 'base'];
  required.push('tier-context', 'verifier-context', 'permit-context', 'trusted-creator');
  const missing = required.filter((k) => !values[k]);
  if (missing.length) fail(`missing --${missing.join(', --')}`);
  const opts = {
    sha: values.sha,
    base: values.base,
    tier: values['tier-context'],
    verifier: values['verifier-context'],
    permit: values['permit-context'],
    trusted: values['trusted-creator'],
    ignore: values['ignore-check'],
  };
  const pr = readJson(values.pr);
  if (!Number.isInteger(pr.changedFiles)) fail(`${values.pr} has no changedFiles`);
  const computed = computedTier(readTiers(values.tiers), readFiles(values.files), pr.changedFiles);
  let result;
  try {
    result = decide(pr, readStatuses(values.status), readJson(values.checks), computed, opts);
  } catch (error) {
    fail(error.message);
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main();
