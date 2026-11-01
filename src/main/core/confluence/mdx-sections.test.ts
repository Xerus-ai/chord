import { describe, expect, it } from 'vitest';
import { splitMdxSections } from './mdx-sections';

/**
 * A rich document publishes as its text plus one image per component (P5
 * decision 2026-09-24). The splitter decides which is which from the MDX
 * syntax tree, and gives every component the file's imports and exports so
 * it compiles on its own.
 */
const SOURCE = [
  "import { Chart } from './chart'",
  'export const data = [1, 2]',
  '',
  '# Report',
  '',
  'Some **text** with <Badge /> inline.',
  '',
  '<Chart data={data} />',
  '',
  'More text.',
  '',
  '<div>',
  '  <Callout>Hi</Callout>',
  '</div>',
  '',
  '{data.length}',
].join('\n');

const PREAMBLE = "import { Chart } from './chart'\nexport const data = [1, 2]";

describe('splitMdxSections', () => {
  it('splits prose from top-level components, in document order', async () => {
    expect(await splitMdxSections(SOURCE)).toEqual([
      { kind: 'markdown', text: '# Report\n\nSome **text** with <Badge /> inline.' },
      { kind: 'component', source: `${PREAMBLE}\n\n<Chart data={data} />` },
      { kind: 'markdown', text: 'More text.' },
      { kind: 'component', source: `${PREAMBLE}\n\n<div>\n  <Callout>Hi</Callout>\n</div>` },
      { kind: 'component', source: `${PREAMBLE}\n\n{data.length}` },
    ]);
  });

  it('treats a line holding only a component as a component, though MDX parses it inline', async () => {
    const source = [
      'export const total = 42',
      '',
      'Some text before.',
      '',
      '<div style={{ padding: 24 }}>Total: {total}</div>',
      '',
      'Closing text with <Badge /> inline.',
    ].join('\n');

    expect(await splitMdxSections(source)).toEqual([
      { kind: 'markdown', text: 'Some text before.' },
      {
        kind: 'component',
        source: 'export const total = 42\n\n<div style={{ padding: 24 }}>Total: {total}</div>',
      },
      { kind: 'markdown', text: 'Closing text with <Badge /> inline.' },
    ]);
  });

  it('is all prose when there are no components', async () => {
    expect(await splitMdxSections('# Only text\n\nA paragraph.\n')).toEqual([
      { kind: 'markdown', text: '# Only text\n\nA paragraph.' },
    ]);
  });

  it('throws on MDX that does not parse, rather than publishing half a document', async () => {
    await expect(splitMdxSections('# Broken\n\n<Chart data={data}\n')).rejects.toThrow();
  });
});
