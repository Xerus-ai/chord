/**
 * Fits a diff into the prompt (plan §Phase 3 slice 4): a diff within the
 * budget is sent whole; one over it is sent as per-file line counts for every
 * file plus the largest hunks that fit (none over half the budget), and is
 * marked `cut` so the prompt can say so.
 */

/** About 15k tokens: room for a real change, well inside every agent's context. */
export const GIT_AI_DIFF_BUDGET_CHARS = 60_000;

/** The heading over the changes Create PR commits before it opens the PR. */
export const PENDING_SECTION_LABEL =
  'Uncommitted changes (Create PR commits these first, so they will be committed with this PR):';

export interface DiffFileStat {
  path: string;
  additions: number;
  deletions: number;
  binary: boolean;
}

export interface BudgetedDiff {
  text: string;
  cut: boolean;
  files: DiffFileStat[];
  omittedHunks: number;
}

export interface DiffSection {
  /** Printed above the section's diff; null for none. */
  label: string | null;
  diff: string;
}

interface ParsedFile {
  stat: DiffFileStat;
  header: string;
  hunks: string[];
}

function pathFromDiffGitLine(line: string): string {
  const rest = line.slice('diff --git '.length);
  // `a/<path> b/<path>`: both halves are the same path.
  const half = (rest.length - 1) / 2;
  return Number.isInteger(half) ? rest.slice(half + 1).replace(/^b\//, '') : rest;
}

function readPath(headerLines: string[]): string {
  const plus = headerLines.find((line) => line.startsWith('+++ '));
  if (plus && plus !== '+++ /dev/null') return plus.slice(4).replace(/^b\//, '');
  const minus = headerLines.find((line) => line.startsWith('--- '));
  if (minus && minus !== '--- /dev/null') return minus.slice(4).replace(/^a\//, '');
  return pathFromDiffGitLine(headerLines[0] ?? '');
}

function parseFile(lines: string[]): ParsedFile {
  const firstHunk = lines.findIndex((line) => line.startsWith('@@'));
  const headerLines = firstHunk === -1 ? lines : lines.slice(0, firstHunk);
  const hunks: string[] = [];
  let additions = 0;
  let deletions = 0;
  if (firstHunk !== -1) {
    let current: string[] = [];
    for (const line of lines.slice(firstHunk)) {
      if (line.startsWith('@@') && current.length > 0) {
        hunks.push(current.join('\n'));
        current = [];
      }
      current.push(line);
      if (line.startsWith('+') && !line.startsWith('+++')) additions += 1;
      else if (line.startsWith('-') && !line.startsWith('---')) deletions += 1;
    }
    hunks.push(current.join('\n'));
  }
  return {
    stat: {
      path: readPath(headerLines),
      additions,
      deletions,
      binary: headerLines.some((line) => /^Binary files .* differ$/.test(line)),
    },
    header: headerLines.join('\n'),
    hunks,
  };
}

/** One `git diff` output, file by file. */
export function parseUnifiedDiff(diff: string): ParsedFile[] {
  const files: string[][] = [];
  for (const line of diff.replace(/\n$/, '').split('\n')) {
    if (line.startsWith('diff --git ')) files.push([line]);
    else if (files.length > 0) files[files.length - 1]!.push(line);
  }
  return files.map(parseFile);
}

function statLine(stat: DiffFileStat): string {
  return stat.binary
    ? `${stat.path} (binary)`
    : `${stat.path} +${stat.additions} -${stat.deletions}`;
}

/** Joined with newlines, the parts' total length is at most this. */
const cost = (parts: string[]) => parts.reduce((sum, part) => sum + part.length + 1, 0);

/** Stats for every file, shortened with a count when even they would not fit. */
function buildStats(sections: { label: string | null; files: ParsedFile[] }[], room: number) {
  const parts: string[] = [];
  for (const section of sections) {
    if (section.label) parts.push(section.label);
    parts.push('Files changed (+added -removed):');
    parts.push(...section.files.map((file) => statLine(file.stat)));
  }
  while (parts.length > 0 && cost(parts) > room) parts.pop();
  const total = sections.reduce((sum, section) => sum + section.files.length, 0);
  const listed = parts.filter((part) => / \+\d+ -\d+$| \(binary\)$/.test(part)).length;
  if (listed < total) {
    const more = `… and ${total - listed} more files`;
    while (parts.length > 0 && cost([...parts, more]) > room) parts.pop();
    if (cost([...parts, more]) <= room) parts.push(more);
  }
  return parts;
}

const HUNKS_HEADING = 'Largest hunks that fit:';

export function budgetDiffSections(sections: DiffSection[], budgetChars: number): BudgetedDiff {
  const present = sections.filter((section) => section.diff.trim().length > 0);
  const parsed = present.map((section) => ({
    label: section.label,
    files: parseUnifiedDiff(section.diff),
  }));
  const files = parsed.flatMap((section) => section.files.map((file) => file.stat));
  const hunkCount = parsed.reduce(
    (sum, section) => sum + section.files.reduce((n, file) => n + file.hunks.length, 0),
    0
  );
  const whole = present
    .map((section) => (section.label ? `${section.label}\n${section.diff}` : section.diff))
    .join('\n');
  if (whole.length <= budgetChars) return { text: whole, cut: false, files, omittedHunks: 0 };

  const stats = buildStats(parsed, budgetChars);
  let room = budgetChars - cost(stats) - (HUNKS_HEADING.length + 1);
  // One hunk may not take more than half the budget: a single generated or
  // vendored block would otherwise crowd out every other file's change.
  const hunkCap = Math.floor(budgetChars / 2);
  const candidates = parsed
    .flatMap((section, s) =>
      section.files.flatMap((file, f) => file.hunks.map((hunk, h) => ({ s, f, h, hunk })))
    )
    .sort((a, b) => b.hunk.length - a.hunk.length);
  const kept = new Set<string>();
  const headed = new Set<string>();
  const labelled = new Set<number>();
  for (const candidate of candidates) {
    const fileKey = `${candidate.s}:${candidate.f}`;
    const label = parsed[candidate.s]!.label;
    const extra =
      candidate.hunk.length +
      1 +
      (headed.has(fileKey) ? 0 : parsed[candidate.s]!.files[candidate.f]!.header.length + 1) +
      (label && !labelled.has(candidate.s) ? label.length + 1 : 0);
    if (extra > room || candidate.hunk.length > hunkCap) continue;
    room -= extra;
    kept.add(`${fileKey}:${candidate.h}`);
    headed.add(fileKey);
    labelled.add(candidate.s);
  }

  const parts = [...stats];
  if (kept.size > 0) {
    parts.push(HUNKS_HEADING);
    parsed.forEach((section, s) => {
      if (section.label && labelled.has(s)) parts.push(section.label);
      section.files.forEach((file, f) => {
        if (!headed.has(`${s}:${f}`)) return;
        parts.push(file.header);
        file.hunks.forEach((hunk, h) => {
          if (kept.has(`${s}:${f}:${h}`)) parts.push(hunk);
        });
      });
    });
  }
  const text = parts.join('\n');
  if (text.length > budgetChars) {
    throw new Error(`Budgeted diff is ${text.length} chars, over its ${budgetChars} budget`);
  }
  return { text, cut: true, files, omittedHunks: hunkCount - kept.size };
}

export function budgetDiff(diff: string, budgetChars: number): BudgetedDiff {
  return budgetDiffSections([{ label: null, diff }], budgetChars);
}
