import {
  CHORD_ID_ATTRIBUTE,
  isChordId,
  MAX_PICKED_TEXT_LENGTH,
} from '@shared/artifact-frame-constants';
import { CHORD_ID_ANCHOR_PREFIX } from './picked-element';

/**
 * Whether a comment's element is still what the comment was made on
 * (bead devstation-975 fix 4). A comment on a page stores the element's id
 * (`chord-id:<id>`) and its reference (`<tag> text`, referenceForPickedElement).
 * Before the comment is shown as anchored or sent to the agent, the id is
 * resolved in the page source as it is now and the element's tag and text
 * are compared with the reference: the same tag and the same collapsed text
 * (capped as the picker caps it) is a match; anything else is reported as
 * "element changed" instead of silently pointing at another element.
 *
 * The comparison is against the source, not the live frame: the source is
 * what the agent edits, and it is what a stamped id names. Text a script
 * puts into an element is therefore reported as changed — the source does
 * not read what the comment quoted.
 */
export type CommentAnchorStatus =
  | { kind: 'matches' }
  | { kind: 'changed'; current: string }
  | { kind: 'missing' }
  | { kind: 'ambiguous' }
  /** The id still resolves, but `count` elements now read the same: a verbatim copy was made. */
  | { kind: 'duplicated'; count: number }
  | { kind: 'unverified' };

/** The page source parsed once, for every comment on it. Scripts never run in a parsed document. */
export type ParsedPageForAnchors = Document;

export function parsePageForAnchors(pageSource: string): ParsedPageForAnchors {
  return new DOMParser().parseFromString(pageSource, 'text/html');
}

/** The stamped id an anchor key names; null for any other anchor, or an id that is not one. */
function chordIdOfAnchorKey(anchorKey: string | null): string | null {
  if (!anchorKey?.startsWith(CHORD_ID_ANCHOR_PREFIX)) return null;
  const id = anchorKey.slice(CHORD_ID_ANCHOR_PREFIX.length);
  return isChordId(id) ? id : null;
}

function collapseText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, MAX_PICKED_TEXT_LENGTH);
}

/** The reference a comment on `element` would store today (referenceForPickedElement). */
function referenceOf(element: Element): string {
  const tag = element.tagName.toLowerCase();
  const text = collapseText(element.textContent ?? '');
  return text ? `<${tag}> ${text}` : `<${tag}>`;
}

function splitReference(reference: string): { tag: string; text: string } | null {
  const match = /^<([a-z0-9-]+)>(?: (.*))?$/s.exec(reference);
  if (!match) return null;
  return { tag: match[1], text: collapseText(match[2] ?? '') };
}

export function verifyCommentAnchor(
  page: ParsedPageForAnchors | null,
  anchorKey: string | null,
  anchorText: string | null
): CommentAnchorStatus {
  const chordId = chordIdOfAnchorKey(anchorKey);
  if (!page || chordId === null || anchorText === null) return { kind: 'unverified' };
  const expected = splitReference(anchorText);
  if (!expected) return { kind: 'unverified' };
  // The id is a validated base-36 token (isChordId), so it needs no escaping.
  const matches = page.querySelectorAll(`[${CHORD_ID_ATTRIBUTE}="${chordId}"]`);
  if (matches.length === 0) return { kind: 'missing' };
  if (matches.length > 1) return { kind: 'ambiguous' };
  const element = matches[0];
  const current = referenceOf(element);
  const same =
    element.tagName.toLowerCase() === expected.tag &&
    collapseText(element.textContent ?? '') === expected.text;
  if (!same) return { kind: 'changed', current };
  // A verbatim copy keeps the tag and text: the id names one of the copies,
  // but nothing the comment stored says which one the user meant.
  const identical = [...page.getElementsByTagName(expected.tag)].filter(
    (candidate) => collapseText(candidate.textContent ?? '') === expected.text
  );
  return identical.length > 1
    ? { kind: 'duplicated', count: identical.length }
    : { kind: 'matches' };
}

function quoteReference(reference: string): string {
  const parts = splitReference(reference);
  if (!parts) return `"${reference}"`;
  return parts.text ? `<${parts.tag}> "${parts.text}"` : `<${parts.tag}>`;
}

/**
 * The prefix of a comment line in an agent prompt. A verified element is
 * named by its id, so the agent edits that element and no other; a changed
 * or missing one is said to have changed, so the agent confirms with the
 * user before acting on what is there now.
 */
export function describeCommentAnchorForAgent(
  anchorKey: string | null,
  anchorText: string | null,
  status: CommentAnchorStatus
): string {
  if (anchorText === null) return '';
  const chordId = chordIdOfAnchorKey(anchorKey);
  const parts = splitReference(anchorText);
  if (status.kind === 'unverified' || chordId === null || !parts) return `On "${anchorText}": `;
  const attribute = `${CHORD_ID_ATTRIBUTE}="${chordId}"`;
  const was = quoteReference(anchorText);
  switch (status.kind) {
    case 'matches':
      return `On the <${parts.tag}> element with ${attribute} ("${parts.text}"): `;
    case 'changed':
      return `Element changed since this comment: it was ${was}; ${attribute} now reads ${quoteReference(status.current)}. Confirm with the user before applying this to it: `;
    case 'missing':
      return `Element changed since this comment: ${was} (${attribute}) is no longer in the page source. Confirm with the user which element is meant: `;
    case 'ambiguous':
      return `Element changed since this comment: more than one element now carries ${attribute} (it was ${was}). Confirm with the user which element is meant: `;
    case 'duplicated':
      return `Element changed since this comment: ${status.count} elements now read ${was} (the comment's id is on one of them, ${attribute}). Confirm with the user which one is meant: `;
  }
}

/** What the comments panel shows under a comment whose element changed; null when it did not. */
export function describeCommentAnchorChange(status: CommentAnchorStatus): string | null {
  switch (status.kind) {
    case 'matches':
    case 'unverified':
      return null;
    case 'changed':
      return `Element changed — now ${quoteReference(status.current)}`;
    case 'missing':
      return 'Element changed — no longer in the page';
    case 'ambiguous':
      return 'Element changed — its id is now shared by several elements';
    case 'duplicated':
      return `Element changed — ${status.count} identical elements now; confirm which one is meant`;
  }
}
