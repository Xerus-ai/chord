import type { BudgetedDiff } from './diff-budget';

/**
 * What the user's agent is asked. It runs with no tools and no files, so the
 * prompt carries everything it may use: the change, the user's own
 * instructions, and — when the diff was over budget — that it was cut.
 */

/** The system prompt every one-shot runs under. */
export const GIT_AI_SYSTEM_PROMPT = [
  'You write git commit messages and pull request descriptions.',
  'You have no tools: do not try to read files, run commands or ask questions.',
  'Everything you may use is in the message. Answer with exactly what it asks for.',
].join(' ');

function branchLine(branch: string | null): string {
  return `Branch: ${branch ?? '(detached HEAD, no branch)'}`;
}

function cutNote(diff: BudgetedDiff): string[] {
  if (!diff.cut) return [];
  return [
    `Note: the diff was cut to fit. Every file is listed with its line counts, but only the largest hunks are shown (${diff.omittedHunks} hunks left out). Describe the whole change from the file list, not only the hunks shown.`,
    '',
  ];
}

function instructionsSection(instructions: string): string[] {
  const trimmed = instructions.trim();
  return trimmed ? ["The user's instructions (follow them):", trimmed, ''] : [];
}

export function buildCommitPrompt(input: {
  branch: string | null;
  diff: BudgetedDiff;
  instructions: string;
}): string {
  return [
    'Write a git commit message for the change below.',
    'Return only the commit message: no preamble, no quotes, no code fences.',
    '',
    'Rules:',
    '- First line: imperative mood, at most 72 characters, no trailing period.',
    '- Then, only if it adds something the subject cannot: a blank line and a short body saying why.',
    '- No "Co-authored-by" or other trailers.',
    '',
    ...instructionsSection(input.instructions),
    branchLine(input.branch),
    '',
    ...cutNote(input.diff),
    'The change:',
    '```diff',
    input.diff.text,
    '```',
  ].join('\n');
}

export function buildPullRequestPrompt(input: {
  branch: string | null;
  base: string;
  commits: string;
  diff: BudgetedDiff;
  template: string | null;
  instructions: string;
}): string {
  const template = input.template?.trim()
    ? [
        "The repository's pull request template. Write the body in its structure: keep its headings and checklists, fill in what the change shows, and leave items you cannot know unchecked.",
        '<template>',
        input.template.trim(),
        '</template>',
        '',
      ]
    : [];
  return [
    'Write the title and description of a pull request for the branch below.',
    'Return only a JSON object, with no code fences or prose around it:',
    '{"title": "short title", "body": "markdown description"}',
    '',
    'Rules:',
    '- "title": concise and specific, no trailing period.',
    '- "body": what changes and why, in plain language; then details a reviewer needs.',
    '- Use only the commits and the diff below; do not invent issues, tests or links.',
    '',
    ...template,
    ...instructionsSection(input.instructions),
    `${branchLine(input.branch)} (head), merging into ${input.base} (base)`,
    '',
    'Commits on this branch, oldest first:',
    input.commits.trim() || '(none yet: every change below is uncommitted)',
    '',
    ...cutNote(input.diff),
    'The diff against the base:',
    '```diff',
    input.diff.text,
    '```',
  ].join('\n');
}
