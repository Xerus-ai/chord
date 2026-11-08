#!/usr/bin/env node
// The commit status the chord-verifier App posts from a review (devstation-4x42.248). The verifier
// workflow runs claude on the review-verifier prompt (.github/verifier/system-prompt.md), whose
// answer ends in one JSON line {"verdict": "APPROVE" | "REQUEST_CHANGES", "findings": [...]}; this
// reads that answer's file and prints the step outputs `state=` and `description=` for
// $GITHUB_OUTPUT. The verdict line is found as the harness's verify-run.py finds it: the last line
// that is a JSON object with a known verdict and a findings list. APPROVE is success,
// REQUEST_CHANGES failure (with its findings counted by severity), and an answer without a verdict
// line is error: nothing approves a review that said nothing. A file it cannot read exits 2.
import { readFileSync } from 'node:fs';

const VERDICTS = new Set(['APPROVE', 'REQUEST_CHANGES']);
const MAX_DESCRIPTION = 140; // GitHub's limit on a commit status description

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

/** { state, description } of the status for a review's text. */
export function statusOf(text) {
  const verdict = parseVerdict(text);
  if (!verdict) return { state: 'error', description: 'the review ended without a verdict line' };
  if (verdict.verdict === 'APPROVE') return { state: 'success', description: 'APPROVE' };
  const bySeverity = new Map();
  for (const f of verdict.findings) {
    const severity = typeof f?.severity === 'string' ? f.severity : 'unrated';
    bySeverity.set(severity, (bySeverity.get(severity) ?? 0) + 1);
  }
  const counts = [...bySeverity].sort().map(([s, n]) => `${n} ${s}`);
  const description = `REQUEST_CHANGES: ${counts.join(', ') || 'no findings listed'}`;
  return { state: 'failure', description: description.slice(0, MAX_DESCRIPTION) };
}

function main() {
  const file = process.argv[2];
  if (!file || process.argv.length > 3) {
    process.stderr.write('usage: verifier-verdict.mjs <review text file>\n');
    process.exit(2);
  }
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (error) {
    process.stderr.write(`verifier-verdict: cannot read ${file}: ${error.message}\n`);
    process.exit(2);
  }
  const { state, description } = statusOf(text);
  process.stdout.write(`state=${state}\ndescription=${description.replace(/[\r\n]+/g, ' ')}\n`);
}

main();
