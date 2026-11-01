import { NodeViewWrapper, type ReactNodeViewProps } from '@tiptap/react';
import { MermaidRenderer } from './mermaid-renderer';

/**
 * Tiptap node view for a `mermaidDiagram` atom. Purely presentational — it
 * hands the node's source to the one shared renderer, which owns rendering and
 * error handling.
 */
export function MermaidNodeView({ node }: ReactNodeViewProps) {
  const code = (node.attrs.code as string) || '';
  return (
    <NodeViewWrapper contentEditable={false}>
      <MermaidRenderer code={code} />
    </NodeViewWrapper>
  );
}
