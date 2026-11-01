import { CHORD_ID_ATTRIBUTE } from '@shared/artifact-frame-constants';
import type { PickedElement } from '@shared/artifact-frame-messages';

/** Comment anchors on a page name the element by its stamped id (plan P1b step 4). */
export const CHORD_ID_ANCHOR_PREFIX = 'chord-id:';

/**
 * The anchor key for a comment on a picked element: its stamped id, or null
 * — an element without one (script-built, or in a prototype) has no identity
 * that survives a reload, so its comment anchors to the artifact instead.
 */
export function anchorKeyForPickedElement(element: PickedElement): string | null {
  return element.chordId ? `${CHORD_ID_ANCHOR_PREFIX}${element.chordId}` : null;
}

/** The short quote shown in the card and stored as a comment's anchor text. */
export function referenceForPickedElement(element: PickedElement): string {
  return element.text ? `<${element.tagName}> ${element.text}` : `<${element.tagName}>`;
}

/**
 * A fallback path is anchored at `body >` or at a unique `#id`
 * (page-element-picker.ts selectorFor); anything else is the tail the picker
 * kept of a path too long to send whole.
 */
function isAnchoredSelector(selector: string): boolean {
  const [first] = selector.split(' > ');
  return first === 'body' || first.includes('#');
}

function describeSelector(element: PickedElement): string {
  if (isAnchoredSelector(element.selector)) {
    return `the <${element.tagName}> element at CSS path \`${element.selector}\``;
  }
  return `the <${element.tagName}> element whose CSS path ends in \`${element.selector}\` (the tail of a path too long to send whole; match it from the end)`;
}

/**
 * Where a compiled page's element was written: the stamp is on the element
 * itself, or on an ancestor when the element is a component's inner markup —
 * then the location is the JSX that renders the component's DOM, not the
 * component's call site.
 */
function describeSourceLocation(element: PickedElement): string | null {
  if (!element.sourceLocation) return null;
  const where = `\`${element.sourceLocation}\` (file relative to the repository, then line:column of the opening tag)`;
  return element.sourceLocationOf === 'element'
    ? `It is written at ${where}.`
    : `It is inside the element written at ${where}.`;
}

/**
 * How the agent is told which element the user means, strongest identity
 * first: the stamped id is unique in the source; otherwise the CSS path and
 * the markup excerpt let it find the element (or the code that renders it).
 */
export function describePickedElementForAgent(element: PickedElement): string {
  const lines = element.chordId
    ? [`the <${element.tagName}> element with ${CHORD_ID_ATTRIBUTE}="${element.chordId}"`]
    : [describeSelector(element)];
  const source = describeSourceLocation(element);
  if (source) lines.push(source);
  if (element.text) lines.push(`Its text: "${element.text}"`);
  lines.push(`Its markup as rendered:\n\`\`\`html\n${element.html}\n\`\`\``);
  return lines.join('\n');
}
