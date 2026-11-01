import { describe, expect, it } from 'vitest';
import { extractPlanOverviewFromMarkdown, extractPlanTitleFromMarkdown } from './plan-content';

// The regression this guards: the ExitPlanMode plan below used to render its
// first bullet ("Line 1: a Markdown heading (`# Plan Test`)") as the card
// title because the heading was never read.
const REAL_PLAN = `# Plan: Create PLAN_TEST_CHORD.md

## Context
This is a trivial, explicitly-scoped test task to verify the plan-approval loop works end-to-end (create → present plan → wait for approval → implement).

## Action
Create a new file at the repository root: \`D:\\Kami\\PLAN_TEST_CHORD.md\`

Content (exactly two lines):
\`\`\`
# Plan Test

Live plan-approval loop test.
\`\`\`

- Line 1: a Markdown heading (\`# Plan Test\`)
- Line 2: the sentence \`Live plan-approval loop test.\`

No other files will be touched.

## Verification
- Confirm \`D:\\Kami\\PLAN_TEST_CHORD.md\` exists and contains exactly the two specified lines.
`;

describe('extractPlanTitleFromMarkdown', () => {
  it('returns the first heading of a real ExitPlanMode plan', () => {
    expect(extractPlanTitleFromMarkdown(REAL_PLAN)).toBe('Plan: Create PLAN_TEST_CHORD.md');
  });

  it('accepts any heading level and strips trailing hashes', () => {
    expect(extractPlanTitleFromMarkdown('## Rework auth ##\n\nbody')).toBe('Rework auth');
  });

  it('returns null when the plan has no heading', () => {
    expect(extractPlanTitleFromMarkdown('just prose\n- and a bullet')).toBeNull();
  });
});

describe('extractPlanOverviewFromMarkdown', () => {
  it('returns the first prose paragraph, skipping headings', () => {
    expect(extractPlanOverviewFromMarkdown(REAL_PLAN)).toBe(
      'This is a trivial, explicitly-scoped test task to verify the plan-approval loop works end-to-end (create → present plan → wait for approval → implement).'
    );
  });

  it('skips fenced code blocks even when they contain prose-like lines', () => {
    const md = '# T\n\n```\nnot the overview\n```\n\nActual overview here.';
    expect(extractPlanOverviewFromMarkdown(md)).toBe('Actual overview here.');
  });

  it('skips list items and blockquotes when looking for prose', () => {
    const md = '# T\n- step one\n> note\n\nOverview after the list.';
    expect(extractPlanOverviewFromMarkdown(md)).toBe('Overview after the list.');
  });

  it('joins wrapped lines of one paragraph and stops at the blank line', () => {
    const md = '# T\n\nFirst line\nsecond line.\n\nNext paragraph.';
    expect(extractPlanOverviewFromMarkdown(md)).toBe('First line second line.');
  });

  it('truncates very long paragraphs', () => {
    const md = `# T\n\n${'word '.repeat(100)}`;
    const overview = extractPlanOverviewFromMarkdown(md);
    expect(overview).not.toBeNull();
    expect(overview!.length).toBeLessThanOrEqual(240);
    expect(overview!.endsWith('...')).toBe(true);
  });

  it('returns null for an all-structure plan (headings and bullets only)', () => {
    expect(extractPlanOverviewFromMarkdown('# T\n- a\n- b')).toBeNull();
  });
});
