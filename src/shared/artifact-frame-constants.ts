/**
 * Constants shared by the host (renderer + main) and the frame bridge that
 * runs inside a sandboxed artifact page (src/artifact-runtime/chord-page.ts).
 * Kept free of runtime dependencies on purpose: the bridge is bundled into
 * the page runtime and must not pull zod along. The zod schemas built on
 * these values live in artifact-frame-messages.ts.
 */

export const PAGE_THEMES = ['chord-dark', 'chord-light'] as const;
export type PageTheme = (typeof PAGE_THEMES)[number];

export function isPageTheme(value: unknown): value is PageTheme {
  return typeof value === 'string' && (PAGE_THEMES as readonly string[]).includes(value);
}

/** Height reports are capped: a page cannot grow the host document unboundedly. */
export const MAX_REPORTED_FRAME_HEIGHT = 20_000;

/** Error messages forwarded from the frame are truncated to this length. */
export const MAX_FRAME_ERROR_LENGTH = 4000;

/** Query parameter the host puts on the frame URL so the first paint is themed. */
export const PAGE_THEME_QUERY_PARAM = 'theme';

/**
 * Prefix of the `name` the host gives every artifact iframe. Main sees it as
 * `WebFrameMain.name` and uses it to tell the host WHICH frame a blocked
 * navigation happened in (see app/window.ts).
 */
export const ARTIFACT_FRAME_NAME_PREFIX = 'chord-page:';

/**
 * The stable id main stamps on every text element of a web page when it is
 * published (plan 2026-09-23 P1b). In-place edits and element comments name an
 * element by this id, never by position, so they survive reflow and reorders.
 */
export const CHORD_ID_ATTRIBUTE = 'data-chord-id';

/** Stamped ids are short lowercase base-36 strings; anything else is re-stamped. */
export const CHORD_ID_PATTERN = /^[a-z0-9]{1,32}$/;

export function isChordId(value: unknown): value is string {
  return typeof value === 'string' && CHORD_ID_PATTERN.test(value);
}

/**
 * Where in its source a compiled page's element was written, stamped by
 * Chord's own compile step on every host element of a prototype or MDX page
 * (bundle-prototype.ts, bundle-mdx.ts): `<file>:<line>:<column>`, the file
 * relative to the work item's repository. Compile-time only — never in the
 * author's files. The picker reports the nearest stamped element, so the
 * agent is told which JSX renders what the user picked.
 */
export const CHORD_SOURCE_ATTRIBUTE = 'data-chord-src';

export const CHORD_SOURCE_LOCATION_PATTERN = /^[^\n]+:\d+:\d+$/;

export function isChordSourceLocation(value: unknown): value is string {
  return typeof value === 'string' && CHORD_SOURCE_LOCATION_PATTERN.test(value);
}

/**
 * What a page frame is doing for the user:
 * - `view` — the page runs untouched.
 * - `edit-text` — a double-click edits a stamped text element in place (web pages).
 * - `pick` — hovering highlights an element; clicking picks it to comment on.
 */
export const PAGE_MODES = ['view', 'edit-text', 'pick'] as const;
export type PageMode = (typeof PAGE_MODES)[number];

export function isPageMode(value: unknown): value is PageMode {
  return typeof value === 'string' && (PAGE_MODES as readonly string[]).includes(value);
}

/**
 * The stamped elements a page may edit in place, sent with the mode: those
 * that are text in the source (editable-text-ids.ts). Capped per message.
 */
export const MAX_EDITABLE_IDS = 10_000;

/** An edited element's text is capped: a page cannot push unbounded text into its source. */
export const MAX_EDIT_TEXT_LENGTH = 10_000;

/** Excerpts of a picked element sent to the host, and on to the agent. */
export const MAX_PICKED_TEXT_LENGTH = 500;
export const MAX_PICKED_HTML_LENGTH = 2_000;
export const MAX_PICKED_SELECTOR_LENGTH = 500;
export const MAX_PICKED_SOURCE_LOCATION_LENGTH = 500;

/**
 * Comment pins on a page (shared-items step 1, S6). A pin is drawn per thread
 * anchored to a stamped element; the cap bounds what one message can make the
 * frame draw.
 */
export const MAX_PAGE_PINS = 200;

export function isPinNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1;
}
