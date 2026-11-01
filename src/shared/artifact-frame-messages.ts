import { z } from 'zod';
import {
  CHORD_ID_PATTERN,
  CHORD_SOURCE_LOCATION_PATTERN,
  MAX_EDIT_TEXT_LENGTH,
  MAX_EDITABLE_IDS,
  MAX_FRAME_ERROR_LENGTH,
  MAX_PAGE_PINS,
  MAX_PICKED_HTML_LENGTH,
  MAX_PICKED_SELECTOR_LENGTH,
  MAX_PICKED_SOURCE_LOCATION_LENGTH,
  MAX_PICKED_TEXT_LENGTH,
  MAX_REPORTED_FRAME_HEIGHT,
  PAGE_MODES,
  PAGE_THEMES,
} from './artifact-frame-constants';

/**
 * The only channel between the renderer (host) and a sandboxed artifact page
 * (frame) is `postMessage`. The frame runs agent-authored code at an opaque
 * origin, so the host treats every message as untrusted: it is parsed against
 * these schemas and dropped when it does not match, and anything whose
 * `event.source` is not the frame's own window is ignored before parsing.
 * Message types are prefixed so a page's own `postMessage` traffic to itself
 * can never collide with the protocol.
 *
 * A page's own script can post these shapes too — it runs in the same window
 * as the bridge. So the host acts on an edit or a pick only while the user
 * has put the frame in the matching mode, and main re-validates every edit
 * against the source file before touching it.
 */

export const pageThemeSchema = z.enum(PAGE_THEMES);
export const pageModeSchema = z.enum(PAGE_MODES);

const chordIdSchema = z.string().regex(CHORD_ID_PATTERN);

const editTextSchema = z.string().max(MAX_EDIT_TEXT_LENGTH);

export const pickedElementSchema = z.object({
  /** The stamped id when the element has one — a web page's authored text. */
  chordId: chordIdSchema.nullable(),
  /**
   * A CSS path for elements without an id (script-built, prototypes):
   * anchored at `body >` or at a unique `#id`, or the unanchored tail of a
   * path too long to send whole.
   */
  selector: z.string().min(1).max(MAX_PICKED_SELECTOR_LENGTH),
  /** `<file>:<line>:<column>` of the nearest stamped element in a compiled page (CHORD_SOURCE_ATTRIBUTE). */
  sourceLocation: z
    .string()
    .max(MAX_PICKED_SOURCE_LOCATION_LENGTH)
    .regex(CHORD_SOURCE_LOCATION_PATTERN)
    .nullable(),
  /** Whether the location is the picked element's own or an ancestor's (a component's inner markup). */
  sourceLocationOf: z.enum(['element', 'ancestor']).nullable(),
  tagName: z.string().min(1).max(64),
  text: z.string().max(MAX_PICKED_TEXT_LENGTH),
  html: z.string().max(MAX_PICKED_HTML_LENGTH),
  /** Viewport box inside the frame, so the host can float its popover next to it. */
  rect: z.object({
    x: z.number().finite(),
    y: z.number().finite(),
    width: z.number().finite().min(0),
    height: z.number().finite().min(0),
  }),
});
export type PickedElement = z.infer<typeof pickedElementSchema>;

const pinNumberSchema = z.number().int().min(1);

/** A comment thread's number, drawn at the stamped element the thread is on. */
export const pagePinSchema = z.object({ n: pinNumberSchema, chordId: chordIdSchema });
export type PagePin = z.infer<typeof pagePinSchema>;

/** An in-place edit as main accepts it: the frame's message plus the artifact it belongs to. */
export const pageTextEditSchema = z.object({
  artifactId: z.string().min(1),
  chordId: chordIdSchema,
  originalText: editTextSchema,
  text: editTextSchema,
});

export const frameToHostMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chord:ready') }),
  z.object({
    type: z.literal('chord:resize'),
    height: z.number().finite().min(0).max(MAX_REPORTED_FRAME_HEIGHT),
  }),
  z.object({ type: z.literal('chord:error'), message: z.string().max(MAX_FRAME_ERROR_LENGTH) }),
  z.object({
    type: z.literal('chord:text-edit'),
    chordId: chordIdSchema,
    /** The element's text when the user started editing; main refuses a stale edit. */
    originalText: editTextSchema,
    text: editTextSchema,
  }),
  z.object({ type: z.literal('chord:element-picked'), element: pickedElementSchema }),
  /** The user clicked a comment pin; the host selects that thread. */
  z.object({ type: z.literal('chord:pin-selected'), n: pinNumberSchema }),
]);
export type FrameToHostMessage = z.infer<typeof frameToHostMessageSchema>;

export const hostToFrameMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('chord:set-theme'), theme: pageThemeSchema }),
  /**
   * `editableIds` are the stamped elements that are text in the source; the
   * frame edits only those, whatever a script has put in the others.
   */
  z.object({
    type: z.literal('chord:set-mode'),
    mode: pageModeSchema,
    editableIds: z.array(chordIdSchema).max(MAX_EDITABLE_IDS),
  }),
  /** The pins to draw (replacing any drawn), and the one whose thread is selected. */
  z.object({
    type: z.literal('chord:set-pins'),
    pins: z.array(pagePinSchema).max(MAX_PAGE_PINS),
    selected: pinNumberSchema.nullable(),
  }),
]);
export type HostToFrameMessage = z.infer<typeof hostToFrameMessageSchema>;
