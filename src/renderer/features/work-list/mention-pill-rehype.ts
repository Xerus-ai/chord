import { findMentions, type RoutableParticipant } from './chat-routing';

/**
 * The slice of hast this transform touches. Declared structurally rather than
 * imported so the mention rules stay a work-list concern and don't pull the
 * markdown pipeline's type surface across the feature boundary.
 */
interface HastNode {
  type: string;
  tagName?: string;
  value?: string;
  properties?: Record<string, unknown>;
  children?: HastNode[];
}

// Text inside these is not prose: a mention in code, in a link label, or in a
// pre block is quoted material and must survive verbatim.
const OPAQUE_TAGS = new Set(['code', 'pre', 'a']);

function mentionPill(text: string): HastNode {
  return {
    type: 'element',
    tagName: 'span',
    properties: { className: ['chat-mention'] },
    children: [{ type: 'text', value: text }],
  };
}

/** The text node split into plain runs and pills, or null when it has none. */
function splitTextNode(
  value: string,
  participants: readonly RoutableParticipant[]
): HastNode[] | null {
  const spans = findMentions(value, participants);
  if (spans.length === 0) return null;

  const parts: HastNode[] = [];
  let cursor = 0;
  for (const span of spans) {
    if (span.start > cursor) parts.push({ type: 'text', value: value.slice(cursor, span.start) });
    parts.push(mentionPill(span.text));
    cursor = span.end;
  }
  if (cursor < value.length) parts.push({ type: 'text', value: value.slice(cursor) });
  return parts;
}

function highlightMentions(node: HastNode, participants: readonly RoutableParticipant[]): void {
  const children = node.children;
  if (!children) return;

  const next: HastNode[] = [];
  let replaced = false;
  for (const child of children) {
    if (child.type === 'text') {
      const parts = splitTextNode(child.value ?? '', participants);
      if (parts) {
        next.push(...parts);
        replaced = true;
      } else {
        next.push(child);
      }
      continue;
    }
    if (!(child.tagName && OPAQUE_TAGS.has(child.tagName))) {
      highlightMentions(child, participants);
    }
    next.push(child);
  }
  if (replaced) node.children = next;
}

/**
 * A rehype plugin that turns every recognised mention in rendered message
 * prose into a `.chat-mention` pill. Built per roster so the same tokenizer
 * that decides who gets notified decides what gets highlighted.
 *
 * Must run AFTER rehype-sanitize: the sanitizer's default schema drops class
 * names it did not put there.
 */
export function createMentionPillPlugin(participants: readonly RoutableParticipant[]) {
  return function rehypeMentionPills() {
    return (tree: HastNode): void => {
      highlightMentions(tree, participants);
    };
  };
}
