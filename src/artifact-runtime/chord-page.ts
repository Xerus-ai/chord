import {
  isChordId,
  isPageMode,
  isPageTheme,
  MAX_EDITABLE_IDS,
  MAX_FRAME_ERROR_LENGTH,
  MAX_REPORTED_FRAME_HEIGHT,
  PAGE_THEME_QUERY_PARAM,
  PAGE_THEMES,
  type PageMode,
  type PageTheme,
} from '@shared/artifact-frame-constants';
import type { FrameToHostMessage, HostToFrameMessage } from '@shared/artifact-frame-messages';
import { createCommentPins, isSetPinsPayload } from './page-comment-pins';
import { createElementPicker } from './page-element-picker';
import { createTextEditing } from './page-text-editing';

/**
 * The frame side of the host <-> page bridge. Runs inside the sandboxed
 * artifact page as the first script, before any authored code. It applies the
 * theme the host asked for, reports the document height so an embedded frame
 * can size itself, forwards uncaught errors, runs the editing modes the host
 * switches it into (edit text in place, pick an element to comment on), and
 * draws the comment pins the host sends.
 * It exposes nothing on `window`: a page that wants to talk to the host has
 * no API to do so.
 *
 * Only a handful of message shapes are accepted, and only from the parent.
 * `zod` is not bundled here on purpose — the runtime stays small and the host
 * validates its own inbound traffic with the shared schema; the constants
 * both sides agree on come from artifact-frame-constants.
 */

function applyTheme(theme: PageTheme): void {
  const root = document.documentElement;
  root.classList.remove(...PAGE_THEMES);
  root.classList.add(theme);
  root.style.colorScheme = theme === 'chord-dark' ? 'dark' : 'light';
}

function post(message: FrameToHostMessage): void {
  // The parent is the only listener; an opaque-origin frame cannot name the
  // host origin, so the target is the wildcard and the HOST filters by source.
  window.parent.postMessage(message, '*');
}

/**
 * The host always sets the theme on the URL it mounts (prepare-page.ts). A
 * page loaded without one, or with a value the host never emits, is not a
 * host-mounted page and is refused rather than silently themed dark.
 */
function themeFromLocation(): PageTheme {
  const requested = new URL(window.location.href).searchParams.get(PAGE_THEME_QUERY_PARAM);
  if (!isPageTheme(requested)) {
    throw new Error(`Artifact page opened without a valid ${PAGE_THEME_QUERY_PARAM} parameter`);
  }
  return requested;
}

function isEditableIdList(value: unknown): value is string[] {
  return Array.isArray(value) && value.length <= MAX_EDITABLE_IDS && value.every(isChordId);
}

function isHostMessage(data: unknown): data is HostToFrameMessage {
  if (typeof data !== 'object' || data === null) return false;
  const record = data as Record<string, unknown>;
  if (record.type === 'chord:set-theme') return isPageTheme(record.theme);
  if (record.type === 'chord:set-mode') {
    return isPageMode(record.mode) && isEditableIdList(record.editableIds);
  }
  if (record.type === 'chord:set-pins') return isSetPinsPayload(record.pins, record.selected);
  return false;
}

const textEditing = createTextEditing(post);
const picker = createElementPicker(post);
const pins = createCommentPins(post);

/**
 * Switching to `pick` while already picking re-arms the picker: that is how
 * the host releases the lock a pick takes once the user is done with it.
 */
function applyMode(mode: PageMode, editableIds: string[]): void {
  if (mode === 'edit-text') textEditing.enable(editableIds);
  else textEditing.disable();
  if (mode === 'pick') picker.arm();
  else picker.disarm();
}

function reportHeight(): void {
  const height = Math.ceil(document.documentElement.scrollHeight);
  post({ type: 'chord:resize', height: Math.min(height, MAX_REPORTED_FRAME_HEIGHT) });
}

applyTheme(themeFromLocation());

window.addEventListener('message', (event) => {
  if (event.source !== window.parent) return;
  if (!isHostMessage(event.data)) return;
  const message = event.data;
  if (message.type === 'chord:set-theme') applyTheme(message.theme);
  else if (message.type === 'chord:set-mode') applyMode(message.mode, message.editableIds);
  else pins.setPins(message.pins, message.selected);
});

window.addEventListener('error', (event) => {
  post({ type: 'chord:error', message: String(event.message).slice(0, MAX_FRAME_ERROR_LENGTH) });
});

window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason instanceof Error ? event.reason.message : String(event.reason);
  post({ type: 'chord:error', message: reason.slice(0, MAX_FRAME_ERROR_LENGTH) });
});

window.addEventListener('DOMContentLoaded', () => {
  post({ type: 'chord:ready' });
  reportHeight();
  const observer = new ResizeObserver(() => reportHeight());
  observer.observe(document.documentElement);
  if (document.body) observer.observe(document.body);
});

window.addEventListener('load', reportHeight);
