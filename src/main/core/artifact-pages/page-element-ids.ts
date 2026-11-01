import { randomBytes } from 'node:crypto';
import { CHORD_ID_ATTRIBUTE, isChordId } from '@shared/artifact-frame-constants';
import {
  applyEdits,
  chordIdOf,
  describeElementAttributes,
  describeElementIdentity,
  escapeHtmlText,
  isTextElement,
  LEADING_HTML_SPACE,
  parsePickableElements,
  tagOfIdentity,
  TRAILING_HTML_SPACE,
  trimHtmlSpace,
  type Parse5,
  type ParsedElement,
  type ParsedText,
  type SourceEdit,
} from './page-source-elements';

function generateChordId(taken: Set<string>): string {
  for (;;) {
    const id = randomBytes(6).readUIntBE(0, 6).toString(36).padStart(8, '0').slice(-8);
    if (!taken.has(id)) return id;
  }
}

/** Elements the parser invented (an implied `<body>`) have no source tag and are never stamped. */
function collectStampableElements(parse5: Parse5, source: string): ParsedElement[] {
  return parsePickableElements(parse5, source).filter(
    (element) => element.sourceCodeLocation?.startTag !== undefined
  );
}

/** What an id named in the previous published source. */
interface PreviousElement {
  identity: string;
  attributes: string;
}

interface PreviousIds {
  elementById: Map<string, PreviousElement>;
  idsByIdentity: Map<string, string[]>;
}

function indexPreviousIds(parse5: Parse5, previousSource: string): PreviousIds {
  const elementById = new Map<string, PreviousElement>();
  const idsByIdentity = new Map<string, string[]>();
  for (const element of collectStampableElements(parse5, previousSource)) {
    const id = chordIdOf(element);
    if (!isChordId(id) || elementById.has(id)) continue;
    const identity = describeElementIdentity(element);
    elementById.set(id, { identity, attributes: describeElementAttributes(element) });
    idsByIdentity.set(identity, [...(idsByIdentity.get(identity) ?? []), id]);
  }
  return { elementById, idsByIdentity };
}

/**
 * Which of several elements sharing one id keeps it: the one that best
 * matches what the id named in the previous published version — same tag,
 * text and attributes first, then same tag and text, then same tag — and the
 * first in document order among equals. With nothing to compare against, the
 * first occurrence keeps it.
 */
function chooseIdKeeper(occurrences: ParsedElement[], previous: PreviousElement | undefined) {
  if (previous === undefined) return occurrences[0];
  const previousTag = tagOfIdentity(previous.identity);
  const score = (element: ParsedElement): number => {
    if (describeElementIdentity(element) === previous.identity) {
      return describeElementAttributes(element) === previous.attributes ? 3 : 2;
    }
    return element.tagName === previousTag ? 1 : 0;
  };
  let best = occurrences[0];
  let bestScore = score(best);
  for (const candidate of occurrences.slice(1)) {
    const candidateScore = score(candidate);
    if (candidateScore > bestScore) {
      best = candidate;
      bestScore = candidateScore;
    }
  }
  return best;
}

/** Elements grouped by the valid id they carry, in document order. */
function groupByChordId(elements: ParsedElement[]): Map<string, ParsedElement[]> {
  const groups = new Map<string, ParsedElement[]>();
  for (const element of elements) {
    const id = chordIdOf(element);
    if (!isChordId(id)) continue;
    groups.set(id, [...(groups.get(id) ?? []), element]);
  }
  return groups;
}

/**
 * An element that comes back without an id (the agent regenerated its tag)
 * recovers the id it had in the previous version when the match is
 * unambiguous — exactly one previous element and exactly one unstamped
 * element have that tag and text — and no element holds that id now.
 */
function recoverDroppedIds(
  unstamped: ParsedElement[],
  previous: PreviousIds,
  assigned: Map<ParsedElement, string>
): void {
  const inUse = new Set(assigned.values());
  const byIdentity = new Map<string, ParsedElement[]>();
  for (const element of unstamped) {
    const identity = describeElementIdentity(element);
    byIdentity.set(identity, [...(byIdentity.get(identity) ?? []), element]);
  }
  for (const [identity, candidates] of byIdentity) {
    const previousIds = previous.idsByIdentity.get(identity);
    if (candidates.length !== 1 || previousIds?.length !== 1) continue;
    const [id] = previousIds;
    if (inUse.has(id)) continue;
    inUse.add(id);
    assigned.set(candidates[0], id);
  }
}

/**
 * Gives every pickable element that is written in the source a stable
 * `data-chord-id`. Idempotent: an element keeps a valid id it already has, so
 * the stamps are a one-time diff. A missing id, an invalid one, or a duplicate
 * (the agent copied an element) gets a fresh one. Only the inserted or
 * replaced attributes change — every other byte is preserved.
 *
 * `previousSource` — the last published version of the same page — lets a
 * republish keep ids where they were: among duplicates, the occurrence that
 * matches the previous element keeps the id (a copy inserted above the
 * original no longer steals it), and an element rewritten without its
 * attribute gets its old id back (recoverDroppedIds). Without it, the first
 * occurrence in document order keeps a duplicated id.
 */
export function stampChordIds(
  parse5: Parse5,
  source: string,
  previousSource?: string
): { html: string; stamped: number } {
  const elements = collectStampableElements(parse5, source);
  const previous = previousSource === undefined ? null : indexPreviousIds(parse5, previousSource);
  const assigned = new Map<ParsedElement, string>();
  for (const [id, occurrences] of groupByChordId(elements)) {
    assigned.set(chooseIdKeeper(occurrences, previous?.elementById.get(id)), id);
  }
  if (previous) {
    recoverDroppedIds(
      elements.filter((element) => !assigned.has(element)),
      previous,
      assigned
    );
  }

  // Fresh ids avoid everything in this source and in the previous one, so a
  // later recovery can never collide with an id handed out here.
  const taken = new Set([...assigned.values(), ...(previous?.elementById.keys() ?? [])]);
  const edits: SourceEdit[] = [];
  for (const element of elements) {
    const current = chordIdOf(element);
    let id = assigned.get(element);
    if (id !== undefined && id === current) continue;
    if (id === undefined) {
      id = generateChordId(taken);
      taken.add(id);
    }
    const location = element.sourceCodeLocation!;
    const attribute = `${CHORD_ID_ATTRIBUTE}="${id}"`;
    const existing = location.attrs?.[CHORD_ID_ATTRIBUTE];
    if (current !== undefined && existing) {
      edits.push({ start: existing.startOffset, end: existing.endOffset, text: attribute });
    } else {
      // Right after the tag name: never inside a trailing `/` or an attribute.
      const at = location.startTag!.startOffset + 1 + element.tagName.length;
      edits.push({ start: at, end: at, text: ` ${attribute}` });
    }
  }

  return { html: applyEdits(source, edits), stamped: edits.length };
}

/** Why an in-place edit was refused. The message is shown to the user as-is. */
export class PageTextEditRejectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PageTextEditRejectedError';
  }
}

function findChordElement(parse5: Parse5, source: string, chordId: string): ParsedElement {
  const matches = parsePickableElements(parse5, source).filter(
    (element) => chordIdOf(element) === chordId
  );
  if (matches.length === 0) {
    throw new PageTextEditRejectedError(
      'This text is no longer in the page source. Reload the page and edit again.'
    );
  }
  if (matches.length > 1) {
    throw new PageTextEditRejectedError(
      'Two elements in the page share this id. Republish the page to re-stamp it.'
    );
  }
  const [element] = matches;
  if (!isTextElement(element)) {
    throw new PageTextEditRejectedError(
      'This element is no longer plain text in the source. Ask the agent to change it.'
    );
  }
  return element;
}

/**
 * Replaces the text of the element stamped `chordId` and nothing else.
 *
 * `originalText` is what the element read when the user started editing. When
 * it does not match the source, the page's script generated or rewrote that
 * text, or the file changed underneath the user — writing the edit would bake
 * runtime text into the source, so it is refused instead.
 *
 * The source's own leading and trailing whitespace around the text is kept,
 * so an edit to `<h1>\n  Title\n</h1>` changes only `Title`.
 */
export function replaceChordElementText(
  parse5: Parse5,
  source: string,
  args: { chordId: string; originalText: string; text: string }
): { html: string; changed: boolean } {
  const element = findChordElement(parse5, source, args.chordId);
  const texts = element.childNodes as ParsedText[];
  const current = texts.map((node) => node.value).join('');
  if (trimHtmlSpace(current) !== trimHtmlSpace(args.originalText)) {
    throw new PageTextEditRejectedError(
      "This text differs from the page source — the page's script changed it, or the file changed while you were editing. Ask the agent to change it."
    );
  }

  const next = trimHtmlSpace(args.text);
  if (next === '') {
    throw new PageTextEditRejectedError(
      'Text cannot be empty. Ask the agent to remove the element.'
    );
  }
  if (next === trimHtmlSpace(current)) return { html: source, changed: false };

  const first = texts[0].sourceCodeLocation;
  const last = texts[texts.length - 1].sourceCodeLocation;
  if (!first || !last) {
    throw new PageTextEditRejectedError('This text has no position in the page source.');
  }
  const raw = source.slice(first.startOffset, last.endOffset);
  // Both patterns match the empty string, so a match always exists.
  const leading = raw.match(LEADING_HTML_SPACE)![0];
  const trailing = raw.match(TRAILING_HTML_SPACE)![0];
  const edit = {
    start: first.startOffset,
    end: last.endOffset,
    text: `${leading}${escapeHtmlText(next)}${trailing}`,
  };
  return { html: applyEdits(source, [edit]), changed: true };
}
