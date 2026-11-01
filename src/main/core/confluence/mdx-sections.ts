import type { RootContent } from 'mdast';

/**
 * A rich document split for Confluence (P5 decision 2026-09-24): prose is
 * converted to storage format, and each top-level component — a JSX block or
 * a `{expression}` block — is rendered in the page sandbox and attached as an
 * image. Inline JSX inside a paragraph stays with the prose.
 */
export type MdxSection = { kind: 'markdown'; text: string } | { kind: 'component'; source: string };

const COMPONENT_NODES = new Set(['mdxJsxFlowElement', 'mdxFlowExpression']);
const INLINE_COMPONENT_NODES = new Set(['mdxJsxTextElement', 'mdxTextExpression']);

/**
 * A component written on one line with content after its opening tag
 * (`<div>Total: {total}</div>`) parses as a paragraph of inline JSX, not a
 * flow element — but on the page it is a block like any other component. A
 * paragraph holding nothing but JSX and expressions is one.
 */
function isComponentNode(node: RootContent): boolean {
  if (COMPONENT_NODES.has(node.type)) return true;
  if (node.type !== 'paragraph') return false;
  const content = node.children.filter(
    (child) => !(child.type === 'text' && child.value.trim() === '')
  );
  return content.length > 0 && content.every((child) => INLINE_COMPONENT_NODES.has(child.type));
}

function sliceNode(source: string, node: RootContent): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start === undefined || end === undefined) {
    throw new Error(`MDX node ${node.type} has no source position`);
  }
  return source.slice(start, end);
}

/**
 * Splits MDX source into prose and components, in document order. Every
 * component's source carries the file's imports and exports, so it compiles
 * alone against the same modules. Throws on MDX that does not parse.
 */
export async function splitMdxSections(source: string): Promise<MdxSection[]> {
  // Loaded on first use so the MDX parser stays out of the startup module graph.
  const [{ fromMarkdown }, { mdxFromMarkdown }, { mdxjs }] = await Promise.all([
    import('mdast-util-from-markdown'),
    import('mdast-util-mdx'),
    import('micromark-extension-mdxjs'),
  ]);
  const tree = fromMarkdown(source, {
    extensions: [mdxjs()],
    mdastExtensions: [mdxFromMarkdown()],
  });
  const preamble = tree.children
    .filter((node) => node.type === 'mdxjsEsm')
    .map((node) => sliceNode(source, node))
    .join('\n');

  const sections: MdxSection[] = [];
  let prose: RootContent[] = [];
  const flushProse = () => {
    if (prose.length === 0) return;
    const first = prose[0]!.position!.start.offset!;
    const last = prose[prose.length - 1]!.position!.end.offset!;
    sections.push({ kind: 'markdown', text: source.slice(first, last) });
    prose = [];
  };

  for (const node of tree.children) {
    if (node.type === 'mdxjsEsm') continue;
    if (isComponentNode(node)) {
      flushProse();
      const component = sliceNode(source, node);
      sections.push({
        kind: 'component',
        source: preamble ? `${preamble}\n\n${component}` : component,
      });
      continue;
    }
    prose.push(node);
  }
  flushProse();
  return sections;
}
