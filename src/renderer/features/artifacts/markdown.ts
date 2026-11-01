import { Marked, type Tokens } from 'marked';

/**
 * `marked` writes a GFM task list as `<li><input type="checkbox">…</li>`, which
 * the editor's TaskItem does not parse — a to-do loaded as a plain bullet. A
 * list whose every item is a task is written in the editor's own markup
 * instead; any other list keeps marked's default rendering.
 */
const artifactMarked = new Marked({
  renderer: {
    list(token: Tokens.List) {
      if (token.ordered || !token.items.every((item) => item.task)) return false;
      const items = token.items
        .map(
          (item) =>
            `<li data-type="taskItem" data-checked="${item.checked === true}">` +
            `${this.parser.parse(item.tokens, item.loose)}</li>\n`
        )
        .join('');
      return `<ul data-type="taskList">\n${items}</ul>\n`;
    },
  },
});

/**
 * Convert raw artifact source to HTML for seeding the Tiptap editor.
 *
 * Artifact source is markdown (`content_type` defaults to 'markdown'), often
 * with an MDX preamble — leading `import` statements and `export const/default`
 * declarations. Those lines are code, not prose. We strip only the *contiguous
 * leading preamble* so that `import`/`export` appearing later in the document
 * (e.g. inside a fenced code sample) is left untouched and renders correctly.
 *
 * Content that is already HTML (an editor re-seed that begins with a tag) is
 * passed through untouched so marked does not escape it.
 */
export function markdownToHtml(raw: string): string {
  const content = stripLeadingMdxPreamble(raw);

  if (content.startsWith('<')) return content;

  const html = artifactMarked.parse(content, { async: false }) as string;
  return routeMermaidFences(html);
}

/**
 * Rewrite fenced ```mermaid code blocks (which `marked` emits as
 * `<pre><code class="language-mermaid">…</code></pre>`) into `<mermaid-diagram>`
 * tags, which the `mermaidDiagram` node picks up and renders. The captured
 * body stays HTML-escaped exactly as `marked` produced it; the node reads it
 * back as text content, so entities decode to the raw mermaid source.
 */
function routeMermaidFences(html: string): string {
  return html.replace(
    /<pre><code class="language-mermaid">([\s\S]*?)<\/code><\/pre>/g,
    (_match, body: string) => `<mermaid-diagram>${body}</mermaid-diagram>`
  );
}

/**
 * Remove the leading run of MDX preamble lines (imports / export declarations
 * and blank lines between them), stopping at the first line of real content.
 * Anything past that first content line — including code fences that contain
 * `import`/`export` — is preserved verbatim.
 */
function stripLeadingMdxPreamble(raw: string): string {
  const lines = raw.split('\n');
  let start = 0;

  for (; start < lines.length; start++) {
    const line = lines[start]!;
    if (line.trim() === '') continue;
    if (/^import\s+/.test(line)) continue;
    if (/^export\s+(const|default|function)\b/.test(line)) continue;
    break;
  }

  return lines.slice(start).join('\n').trimStart();
}
