#!/usr/bin/env node
// The commit status the chord-verifier App posts from a review (devstation-4x42.248). The verifier
// workflow runs claude on the review-verifier prompt (.github/verifier/system-prompt.md), whose
// answer ends in one JSON line {"verdict": "APPROVE" | "REQUEST_CHANGES", "findings": [...]}; this
// reads that answer's file and prints the step outputs `state=` and `description=` for
// $GITHUB_OUTPUT. The verdict line is found as the harness's verify-run.py finds it: the last line
// that is a JSON object with a known verdict and a findings list. APPROVE is success,
// REQUEST_CHANGES failure (with its findings counted by severity), and an answer without a verdict
// line is error: nothing approves a review that said nothing. A file it cannot read exits 2.
//
// Under Actions (GITHUB_ACTIONS=true) it also keeps the review (devstation-4x42.292): it appends the
// findings to $GITHUB_STEP_SUMMARY and writes the verdict to $RUNNER_TEMP/verifier-verdict.json, the
// artifact the workflow uploads. It does this itself because a permit never changes a run: step of
// the pull_request_target workflow. The findings are a model's answer about a PR: data, rendered as
// text inside a fence no finding can close. Either variable missing under Actions exits 2.
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const VERDICTS = new Set(['APPROVE', 'REQUEST_CHANGES']);
const MAX_DESCRIPTION = 140; // GitHub's limit on a commit status description
const MAX_TAIL = 4000; // characters of an answer without a verdict line kept in the summary
export const VERDICT_FILE = 'verifier-verdict.json';

/** The verdict object of a review's text, or null when no line holds one. */
export function parseVerdict(text) {
  const lines = text.split(/\r?\n/).reverse();
  for (const raw of lines) {
    const line = raw.trim();
    if (!line.startsWith('{')) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // a line that only starts like JSON is prose, not the verdict
    }
    const findings = obj?.findings ?? [];
    if (obj && VERDICTS.has(obj.verdict) && Array.isArray(findings)) return { ...obj, findings };
  }
  return null;
}

function severityOf(finding) {
  return typeof finding?.severity === 'string' ? finding.severity : 'unrated';
}

/** { state, description } of the status for a parsed verdict (null: no verdict line). */
function statusOfVerdict(verdict) {
  if (!verdict) return { state: 'error', description: 'the review ended without a verdict line' };
  if (verdict.verdict === 'APPROVE') return { state: 'success', description: 'APPROVE' };
  const { findings } = verdict;
  const bySeverity = new Map();
  for (const f of findings) bySeverity.set(severityOf(f), (bySeverity.get(severityOf(f)) ?? 0) + 1);
  const counts = [...bySeverity].sort().map(([s, n]) => `${n} ${s}`);
  const description = `REQUEST_CHANGES: ${counts.join(', ') || 'no findings listed'}`;
  return { state: 'failure', description: description.slice(0, MAX_DESCRIPTION) };
}

/** { state, description } of the status for a review's text. */
export function statusOf(text) {
  return statusOfVerdict(parseVerdict(text));
}

/** text in a fenced block whose fence is longer than any backtick run in it: it renders as text. */
function fenced(text) {
  const longest = Math.max(0, ...(text.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(Math.max(5, longest + 1));
  return `${fence}\n${text}\n${fence}`;
}

function findingLine(f) {
  const where =
    typeof f?.file === 'string' ? `${f.file}${f.line != null ? `:${f.line}` : ''}` : '(no file)';
  const issue = typeof f?.issue === 'string' ? f.issue : JSON.stringify(f);
  return `[${severityOf(f)}] ${where}\n    ${issue.replace(/\r?\n/g, '\n    ')}`;
}

/**
 * The job summary's markdown for a review's text. Outside the one fence it holds only this
 * script's own words and the state: the description carries the model's severity strings, so it
 * goes inside the fence with the findings.
 */
export function summaryOf(text) {
  const verdict = parseVerdict(text);
  const { state, description } = statusOfVerdict(verdict);
  const status = description.replace(/[\r\n]+/g, ' ');
  if (!verdict)
    return `## verifier: ${state}\n\nThe status and the answer's last ${MAX_TAIL} characters:\n\n${fenced(`${status}\n\n${text.slice(-MAX_TAIL)}`)}\n`;
  const body =
    verdict.findings.length === 0 ? 'No findings.' : verdict.findings.map(findingLine).join('\n\n');
  return `## verifier: ${state}\n\n${fenced(`${status}\n\n${body}`)}\n`;
}

function fail(message) {
  process.stderr.write(`verifier-verdict: ${message}\n`);
  process.exit(2);
}

/** Under Actions: the summary appended and the verdict JSON written, after both are checked. */
function keepReview(text, status) {
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const temp = process.env.RUNNER_TEMP;
  if (!summary) fail('GITHUB_ACTIONS is true but GITHUB_STEP_SUMMARY is not set');
  if (!temp) fail('GITHUB_ACTIONS is true but RUNNER_TEMP is not set');
  const verdict = parseVerdict(text);
  const kept = { ...status, verdict: verdict?.verdict ?? null, findings: verdict?.findings ?? [] };
  writeFileSync(join(temp, VERDICT_FILE), `${JSON.stringify(kept, null, 2)}\n`);
  appendFileSync(summary, summaryOf(text));
}

function main() {
  const file = process.argv[2];
  if (!file || process.argv.length > 3) fail('usage: verifier-verdict.mjs <review text file>');
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    fail(`cannot read ${file}: ${error.message}`);
  }
  const { state, description } = statusOf(text);
  if (process.env.GITHUB_ACTIONS === 'true') keepReview(text, { state, description });
  process.stdout.write(`state=${state}\ndescription=${description.replace(/[\r\n]+/g, ' ')}\n`);
}

main();
