import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';
import { MdxNodeView } from './mdx-node-view';

export const MdxExtension = Node.create({
  name: 'mdxComponent',
  group: 'block',
  content: 'inline*',

  addAttributes() {
    return {
      'data-path': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-path'),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-path': attributes['data-path'] as string,
        }),
      },
      'data-work-item-id': {
        default: null,
        parseHTML: (element: HTMLElement) => element.getAttribute('data-work-item-id'),
        renderHTML: (attributes: Record<string, unknown>) => ({
          'data-work-item-id': attributes['data-work-item-id'] as string,
        }),
      },
    };
  },

  parseHTML() {
    return [{ tag: 'mdx-component' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['mdx-component', HTMLAttributes];
  },

  addNodeView() {
    return ReactNodeViewRenderer(MdxNodeView, {
      attrs: { contentEditable: 'false' },
    });
  },
});
