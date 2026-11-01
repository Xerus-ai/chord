import { useEffect, useId, useRef, useState } from 'react';
import {
  ARTIFACT_FRAME_NAME_PREFIX,
  MAX_PAGE_PINS,
  MAX_REPORTED_FRAME_HEIGHT,
  type PageMode,
  type PageTheme,
} from '@shared/artifact-frame-constants';
import {
  frameToHostMessageSchema,
  type HostToFrameMessage,
  type PagePin,
  type PickedElement,
} from '@shared/artifact-frame-messages';
import {
  artifactFrameNavigationBlockedChannel,
  type ArtifactFrameNavigationBlocked,
} from '@shared/events/artifactEvents';
import { events } from '@renderer/lib/ipc';

interface PageFrameProps {
  /** A `chord-artifact://` URL returned by `rpc.artifactPages.prepare*`. */
  url: string;
  theme: PageTheme;
  title: string;
  /**
   * `fill` stretches to the container (a page tab); `content` follows the
   * height the frame reports (an MDX component inside a document).
   */
  sizing: 'fill' | 'content';
  /** An uncaught error inside the page, forwarded by the frame bridge. */
  onPageError?: (message: string) => void;
  /**
   * The page tried to navigate the frame to a foreign origin and the renderer
   * CSP refused it, leaving Chromium's error page in the frame. The owner
   * remounts the page (a new URL) in response.
   */
  onNavigationBlocked?: () => void;
  /** What the user has the page doing; `view` when absent (embedded MDX). */
  mode?: PageMode;
  /**
   * Bumped to re-send an unchanged mode. Re-sending `pick` releases the lock
   * a pick takes, once the user is done with the picked element.
   */
  modeEpoch?: number;
  /** The stamped elements that are text in the source: what `edit-text` may edit. */
  editableIds?: string[];
  /** A stamped element's text was edited in place (only while `mode` is `edit-text`). */
  onTextEdit?: (edit: { chordId: string; originalText: string; text: string }) => void;
  /** An element was picked (only while `mode` is `pick`). */
  onElementPicked?: (element: PickedElement) => void;
  /** Comment pins to draw, and the selected thread's number (shared-items step 1, S6). */
  pins?: PagePin[];
  selectedPin?: number | null;
  /** A pin was clicked; only a number the host sent is passed on. */
  onPinSelected?: (n: number) => void;
}

const NO_PINS: PagePin[] = [];
const NO_IDS: string[] = [];

const MIN_CONTENT_HEIGHT = 48;

/**
 * The host side of the sandbox. `sandbox="allow-scripts"` and nothing else:
 * no `allow-same-origin`, so the page has an opaque origin and cannot reach
 * this document, its storage, or the preload bridge; no forms, popups or top
 * navigation. `srcdoc` is never used — it would inherit this document's CSP
 * and origin — and `<webview>` is disabled app-wide.
 *
 * Every inbound message is checked to come from this frame's own window and
 * parsed against the shared schema before anything reacts to it.
 *
 * Theme: the URL carries the theme for the first paint. Later switches are
 * pushed with `chord:set-theme`, but only once the page has said
 * `chord:ready` — a message posted before that lands in the iframe's initial
 * `about:blank` window and is lost, which left a toggled theme stale.
 *
 * The iframe's `name` is how main identifies this frame when a navigation
 * inside it is blocked (app/window.ts); the host cannot see a cross-origin
 * frame's location itself.
 *
 * Modes: the page's own script shares a window with the bridge and can post
 * an edit, a pick or a pin message itself. So an edit is acted on only while the
 * user has the frame in `edit-text`, and a pick only in `pick` — a page
 * cannot rewrite its source, or open an agent prompt, on its own.
 */
export function PageFrame({
  url,
  theme,
  title,
  sizing,
  onPageError,
  onNavigationBlocked,
  mode = 'view',
  modeEpoch = 0,
  editableIds = NO_IDS,
  onTextEdit,
  onElementPicked,
  pins = NO_PINS,
  selectedPin = null,
  onPinSelected,
}: PageFrameProps) {
  const frameRef = useRef<HTMLIFrameElement>(null);
  const frameName = `${ARTIFACT_FRAME_NAME_PREFIX}${useId()}`;
  const [contentHeight, setContentHeight] = useState(MIN_CONTENT_HEIGHT);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      const frame = frameRef.current;
      if (!frame || event.source !== frame.contentWindow) return;
      const parsed = frameToHostMessageSchema.safeParse(event.data);
      if (!parsed.success) return;
      const message = parsed.data;
      if (message.type === 'chord:ready') {
        setReady(true);
      } else if (message.type === 'chord:resize') {
        const height = Math.min(Math.ceil(message.height), MAX_REPORTED_FRAME_HEIGHT);
        setContentHeight(Math.max(MIN_CONTENT_HEIGHT, height));
      } else if (message.type === 'chord:error') {
        onPageError?.(message.message);
      } else if (message.type === 'chord:text-edit') {
        if (mode !== 'edit-text') return;
        onTextEdit?.({
          chordId: message.chordId,
          originalText: message.originalText,
          text: message.text,
        });
      } else if (message.type === 'chord:element-picked') {
        if (mode !== 'pick') return;
        onElementPicked?.(message.element);
      } else if (message.type === 'chord:pin-selected') {
        // The page's own script can post this too: only a pin that was sent counts.
        if (!pins.some((pin) => pin.n === message.n)) return;
        onPinSelected?.(message.n);
      }
    };
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onPageError, mode, onTextEdit, onElementPicked, pins, onPinSelected]);

  useEffect(() => {
    const target = frameRef.current?.contentWindow;
    if (!ready || !target) return;
    const message: HostToFrameMessage = { type: 'chord:set-theme', theme };
    // The frame's origin is opaque, so it cannot be named; the bridge accepts
    // only its parent as a sender and only this message shape.
    target.postMessage(message, '*');
  }, [theme, ready]);

  // A reload drops the frame's mode with its document; `ready` flips back on
  // the new document's `chord:ready`, which re-sends it.
  useEffect(() => {
    const target = frameRef.current?.contentWindow;
    if (!ready || !target) return;
    const message: HostToFrameMessage = {
      type: 'chord:set-mode',
      mode,
      editableIds: mode === 'edit-text' ? editableIds : NO_IDS,
    };
    target.postMessage(message, '*');
  }, [mode, modeEpoch, editableIds, ready]);

  useEffect(() => {
    const target = frameRef.current?.contentWindow;
    if (!ready || !target) return;
    // The frame refuses a longer list outright; the oldest threads keep their pins.
    const message: HostToFrameMessage = {
      type: 'chord:set-pins',
      pins: pins.slice(0, MAX_PAGE_PINS),
      selected: selectedPin,
    };
    target.postMessage(message, '*');
  }, [pins, selectedPin, ready]);

  useEffect(() => {
    if (!onNavigationBlocked) return;
    return events.on(
      artifactFrameNavigationBlockedChannel,
      (blocked: ArtifactFrameNavigationBlocked) => {
        if (blocked.frameName === frameName) onNavigationBlocked();
      }
    );
  }, [frameName, onNavigationBlocked]);

  return (
    <iframe
      ref={frameRef}
      name={frameName}
      title={title}
      src={url}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      className={
        sizing === 'fill'
          ? 'block h-full w-full flex-1 border-0 bg-surface'
          : 'block w-full border-0 bg-transparent'
      }
      style={sizing === 'content' ? { height: contentHeight } : undefined}
    />
  );
}
