import type { DefaultTreeAdapterMap } from 'parse5';
import { CHORD_ID_ATTRIBUTE } from '@shared/artifact-frame-constants';

/** parse5, loaded on first use so it stays out of the startup module graph. */
export const loadParse5 = () => import('parse5');
export type Parse5 = Awaited<ReturnType<typeof loadParse5>>;

export type ParsedNode = DefaultTreeAdapterMap['node'];
export type ParsedElement = DefaultTreeAdapterMap['element'];
export type ParsedText = DefaultTreeAdapterMap['textNode'];

/**
 * Subtrees whose text is not page copy: metadata, code, form internals, and
 * foreign (SVG/MathML) content, where contenteditable does not work.
 */
const NON_COPY_TAGS = new Set([
  'head',
  'script',
  'style',
  'template',
  'noscript',
  'textarea',
  'title',
  'select',
  'option',
  'iframe',
  'xmp',
  'plaintext',
]);

/**
 * Elements that never render a box of their own, so the picker can never
 * land on them: the document skeleton and void metadata or break tags.
 */
const UNPICKABLE_TAGS = new Set([
  'html',
  'body',
  'br',
  'wbr',
  'meta',
  'link',
  'base',
  'source',
  'track',
  'param',
  'area',
  'map',
  'col',
  'colgroup',
  'datalist',
  'slot',
]);

/** HTML's own whitespace set — JS `\s` and `trim()` also eat U+00A0, which is copy. */
export const LEADING_HTML_SPACE = /^[ \t\n\f\r]*/;
export const TRAILING_HTML_SPACE = /[ \t\n\f\r]*$/;

export function trimHtmlSpace(text: string): string {
  return text.replace(LEADING_HTML_SPACE, '').replace(TRAILING_HTML_SPACE, '');
}

function isElement(node: ParsedNode): node is ParsedElement {
  return 'tagName' in node;
}

export function isText(node: ParsedNode): node is ParsedText {
  return node.nodeName === '#text';
}

export function chordIdOf(element: ParsedElement): string | undefined {
  return element.attrs.find((attr) => attr.name === CHORD_ID_ATTRIBUTE)?.value;
}

/**
 * A text element is one whose children are all text with some copy in it —
 * `<h1>Title</h1>`, `<button>Save</button>`. Mixed content (`<p>a <b>b</b></p>`)
 * is not: replacing its text would drop the markup, so only its leaf children
 * are editable and the rest goes through the agent.
 */
export function isTextElement(element: ParsedElement): boolean {
  if (element.childNodes.length === 0) return false;
  if (!element.childNodes.every(isText)) return false;
  return element.childNodes.some((child) => trimHtmlSpace((child as ParsedText).value) !== '');
}

/**
 * Every element a user can pick in the frame, in document order, parsed from
 * `source` with source locations: HTML elements outside non-copy subtrees,
 * plus the root of a foreign (SVG, MathML) subtree — the picker lands on the
 * `<svg>` as a whole, never on its children, which contenteditable and the
 * text editor cannot handle either.
 */
export function parsePickableElements(parse5: Parse5, source: string): ParsedElement[] {
  const root = parse5.parse(source, { sourceCodeLocationInfo: true });
  const found: ParsedElement[] = [];
  const visit = (node: ParsedNode): void => {
    if (isElement(node)) {
      if (node.namespaceURI !== parse5.html.NS.HTML) {
        found.push(node);
        return;
      }
      if (NON_COPY_TAGS.has(node.tagName)) return;
      if (!UNPICKABLE_TAGS.has(node.tagName)) found.push(node);
    }
    if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(root);
  return found;
}

/** The element's text as the picker reports it: every descendant text node, whitespace collapsed. */
export function collapsedTextOf(element: ParsedElement): string {
  const parts: string[] = [];
  const visit = (node: ParsedNode): void => {
    if (isText(node)) parts.push(node.value);
    else if ('childNodes' in node) node.childNodes.forEach(visit);
  };
  visit(element);
  return parts.join('').replace(/\s+/g, ' ').trim();
}

/**
 * What identifies an element across two versions of the source: its tag and
 * text. An element with no text of its own (an image, an empty container) is
 * told apart by its other attributes instead.
 */
const IDENTITY_SEPARATOR = '\u0000';

export function describeElementIdentity(element: ParsedElement): string {
  const text = collapsedTextOf(element);
  if (text !== '') return `${element.tagName}${IDENTITY_SEPARATOR}${text}`;
  const attrs = describeElementAttributes(element);
  return `${element.tagName}${IDENTITY_SEPARATOR}${IDENTITY_SEPARATOR}${attrs}`;
}

/** Every attribute but the id, in a fixed order — what tells two same-text elements apart. */
export function describeElementAttributes(element: ParsedElement): string {
  return element.attrs
    .filter((attr) => attr.name !== CHORD_ID_ATTRIBUTE)
    .map((attr) => `${attr.name}=${attr.value}`)
    .sort()
    .join('\u0001');
}

/** U+00A0, kept visible in the source as `&nbsp;` rather than an invisible character. */
const NO_BREAK_SPACE = new RegExp(String.fromCharCode(0xa0), 'g');

export function escapeHtmlText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(NO_BREAK_SPACE, '&nbsp;');
}

/** The tag half of an identity from describeElementIdentity. */
export function tagOfIdentity(identity: string): string {
  return identity.slice(0, identity.indexOf(IDENTITY_SEPARATOR));
}

export interface SourceEdit {
  start: number;
  end: number;
  text: string;
}

/** Applies non-overlapping edits back to front, so earlier offsets stay valid. */
export function applyEdits(source: string, edits: SourceEdit[]): string {
  let result = source;
  for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  }
  return result;
}
