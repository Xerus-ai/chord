import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import Markdown from 'react-markdown';
import { describe, expect, it } from 'vitest';
import { buildMarkdownPlugins } from './markdown-pipeline';

function renderTyped(markdown: string): string {
  const plugins = buildMarkdownPlugins({ variant: 'compact', htmlAsText: true });
  return renderToStaticMarkup(createElement(Markdown, plugins, markdown));
}

describe('buildMarkdownPlugins with htmlAsText (a person typed it)', () => {
  it('keeps an inline <placeholder> as the text that was typed', () => {
    expect(renderTyped('reply with LANG=<my answer>, nothing else')).toBe(
      '<p>reply with LANG=&lt;my answer&gt;, nothing else</p>'
    );
  });

  it('keeps a line that parses as an HTML block, as a paragraph', () => {
    expect(renderTyped('<my answer>\n\nthen more')).toBe(
      '<p>&lt;my answer&gt;</p>\n<p>then more</p>'
    );
  });

  it('keeps tags that are real HTML as text too', () => {
    expect(renderTyped('a <b>bold</b> claim')).toBe('<p>a &lt;b&gt;bold&lt;/b&gt; claim</p>');
  });

  it('still renders markdown around it', () => {
    expect(renderTyped('**set** `<x>` to <value>')).toBe(
      '<p><strong>set</strong> <code>&lt;x&gt;</code> to &lt;value&gt;</p>'
    );
  });
});
