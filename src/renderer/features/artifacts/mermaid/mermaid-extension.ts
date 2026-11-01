import { mergeAttributes, Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MermaidNodeView } from './mermaid-node-view';

/**
 * A rendered mermaid diagram. Atom leaf node — it holds the mermaid source in
 * an attribute and renders (read-only) via the node view; it has no editable
 * inline content. The source round-trips as the tag's text content.
 */
export const MermaidExtension = Node.create({
  name: 'mermaidDiagram',
  group: 'block',
  atom: true,
  selectable: true,
  draggable: true,

  addAttributes() {
    return {
      code: {
        default: '',
        parseHTML: (element: HTMLElement) =>
          element.getAttribute('data-code') ?? element.textContent ?? '',
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mermaid-diagram' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return ['mermaid-diagram', mergeAttributes(HTMLAttributes), (node.attrs.code as string) ?? ''];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MermaidNodeView);
  },
});
