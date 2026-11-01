import * as Y from 'yjs';
import { escapeAttribute, escapeHtml } from './html.js';

/**
 * Read-only HTML for a document artifact's Yjs state — the public view's
 * renderer (P6). Walks the TipTap fragment ('default', artifact-editor.tsx)
 * directly, so the server needs no editor schema: every node the editor
 * writes maps to one element, text carries its marks, and everything is
 * escaped. A node this renderer does not know (an embedded interactive
 * component) renders as a note to open the artifact in Chord, never as raw
 * markup.
 */

const COLLAB_FIELD = 'default';

const MDX_COMPONENT_NOTE = 'Interactive component — open it in Chord';

const BLOCK_TAGS: Record<string, string> = {
  paragraph: 'p',
  blockquote: 'blockquote',
  bulletList: 'ul',
  orderedList: 'ol',
  listItem: 'li',
  taskList: 'ul',
  table: 'table',
  tableRow: 'tr',
  tableCell: 'td',
  tableHeader: 'th',
};

const MARK_TAGS: [string, string][] = [
  ['bold', 'strong'],
  ['italic', 'em'],
  ['strike', 's'],
  ['underline', 'u'],
  ['code', 'code'],
];

export interface RenderedDocument {
  html: string;
  /** Plain text, for the OpenGraph description. */
  text: string;
}

export function renderDocumentHtml(state: Uint8Array): RenderedDocument {
  const doc = new Y.Doc();
  Y.applyUpdate(doc, state);
  const fragment = doc.getXmlFragment(COLLAB_FIELD);
  const text: string[] = [];
  const html = fragment
    .toArray()
    .map((node) => renderNode(node, text))
    .join('');
  doc.destroy();
  return { html, text: text.join(' ').replace(/\s+/g, ' ').trim() };
}

function renderNode(node: Y.XmlElement | Y.XmlText | Y.XmlHook, text: string[]): string {
  if (node instanceof Y.XmlText) return renderText(node, text);
  if (!(node instanceof Y.XmlElement)) return '';

  const children = () =>
    node
      .toArray()
      .map((child) => renderNode(child as Y.XmlElement | Y.XmlText, text))
      .join('');
  const name = node.nodeName;

  if (name === 'heading') {
    const level = Math.min(6, Math.max(1, Number(node.getAttribute('level')) || 1));
    return `<h${level}>${children()}</h${level}>`;
  }
  if (name === 'codeBlock') return `<pre><code>${children()}</code></pre>`;
  if (name === 'horizontalRule') return '<hr>';
  if (name === 'hardBreak') return '<br>';
  if (name === 'taskItem') {
    // y-prosemirror stores attributes as their JS values; typed as strings by Yjs.
    const checked: unknown = node.getAttribute('checked');
    const isChecked = checked === true || checked === 'true';
    return `<li><input type="checkbox" disabled${isChecked ? ' checked' : ''}> ${children()}</li>`;
  }
  // A legacy <mdx-component data-path> node (P6 §9 decision 2): the component
  // runs only on the author's device, and its path is theirs — neither leaks.
  if (name === 'mdxComponent') return `<p class="note">${MDX_COMPONENT_NOTE}</p>`;
  if (name === 'image') {
    const alt = String(node.getAttribute('alt') ?? '');
    return `<p class="note">[Image${alt ? `: ${escapeHtml(alt)}` : ''}]</p>`;
  }
  const tag = BLOCK_TAGS[name];
  if (tag) return `<${tag}>${children()}</${tag}>`;
  return '<p class="note">[Interactive content — open this artifact in Chord to see it]</p>';
}

function renderText(node: Y.XmlText, text: string[]): string {
  return (node.toDelta() as { insert: unknown; attributes?: Record<string, unknown> }[])
    .map((op) => {
      if (typeof op.insert !== 'string') return '';
      text.push(op.insert);
      let out = escapeHtml(op.insert);
      const marks = op.attributes ?? {};
      for (const [mark, tag] of MARK_TAGS) {
        if (marks[mark]) out = `<${tag}>${out}</${tag}>`;
      }
      const link = marks.link as { href?: unknown } | undefined;
      if (link && typeof link.href === 'string' && /^https?:\/\//i.test(link.href)) {
        out = `<a href="${escapeAttribute(link.href)}" rel="noopener noreferrer nofollow" target="_blank">${out}</a>`;
      }
      return out;
    })
    .join('');
}
