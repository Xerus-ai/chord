import rehypeRaw from 'rehype-raw';
import rehypeSanitize, { defaultSchema } from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import type { PluggableList } from 'unified';

export type MarkdownVariant = 'full' | 'compact';

/** Sanitize schema that also allows data: URIs on images */
const sanitizeSchema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    src: [...(defaultSchema.protocols?.src || []), 'data'],
  },
};

/** The slice of mdast `remarkHtmlAsText` touches, declared structurally. */
interface MdastNode {
  type: string;
  value?: string;
  children?: MdastNode[];
}

// Parents whose children are blocks: text placed there needs a paragraph.
const FLOW_PARENTS = new Set(['root', 'blockquote', 'listItem', 'footnoteDefinition']);

function literalizeHtml(parent: MdastNode): void {
  if (!parent.children) return;
  parent.children = parent.children.map((child) => {
    if (child.type !== 'html') {
      literalizeHtml(child);
      return child;
    }
    const text: MdastNode = { type: 'text', value: child.value };
    return FLOW_PARENTS.has(parent.type) ? { type: 'paragraph', children: [text] } : text;
  });
}

/**
 * Turns HTML back into the characters it was written as. Sanitizing drops raw
 * HTML, so without this a person's `LANG=<my answer>` renders as `LANG=`.
 */
function remarkHtmlAsText() {
  return (tree: MdastNode): void => literalizeHtml(tree);
}

/** The remark and rehype plugins `MarkdownRenderer` hands to react-markdown. */
export function buildMarkdownPlugins(opts: {
  variant: MarkdownVariant;
  /** Text a person typed: `<…>` in it is prose, never markup. */
  htmlAsText?: boolean;
  extraRehypePlugins?: PluggableList;
}): { remarkPlugins: PluggableList; rehypePlugins: PluggableList } {
  const extra = opts.extraRehypePlugins ?? [];
  return {
    remarkPlugins: opts.htmlAsText ? [remarkGfm, remarkHtmlAsText] : [remarkGfm],
    rehypePlugins:
      opts.variant === 'full'
        ? [rehypeRaw, [rehypeSanitize, sanitizeSchema], ...extra]
        : [[rehypeSanitize, sanitizeSchema], ...extra],
  };
}
