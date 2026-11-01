import { useEffect, useRef, useState } from 'react';
import type { MoveTabRequest } from './center-layout-split';
import {
  bodyDropToMove,
  isTabDrag,
  readTabDrag,
  resolveDropZone,
  type PaneDropZone,
} from './pane-drop-zone';

/**
 * A pane's focus-on-press and body drop target, as native listeners. Room and
 * session bodies are portaled in from `RetainedBodyHost`, so their React
 * events never reach the pane's JSX handlers; DOM events still bubble here.
 */
export function usePaneDomEvents(
  paneId: string,
  { onFocus, onMove }: { onFocus: () => void; onMove: (move: MoveTabRequest) => void }
) {
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [dropZone, setDropZone] = useState<PaneDropZone | null>(null);
  const latest = useRef({ paneId, onFocus, onMove });
  useEffect(() => {
    latest.current = { paneId, onFocus, onMove };
  });

  useEffect(() => {
    if (!root) return;
    const focus = () => latest.current.onFocus();
    root.addEventListener('mousedown', focus, true);
    return () => root.removeEventListener('mousedown', focus, true);
  }, [root]);

  useEffect(() => {
    if (!body) return;
    const zoneAt = (e: DragEvent) =>
      resolveDropZone(body.getBoundingClientRect(), e.clientX, e.clientY);
    const over = (e: DragEvent) => {
      if (!isTabDrag(e)) return;
      e.preventDefault();
      setDropZone(zoneAt(e));
    };
    const leave = (e: DragEvent) => {
      if (!body.contains(e.relatedTarget as Node | null)) setDropZone(null);
    };
    const drop = (e: DragEvent) => {
      const dragged = readTabDrag(e);
      setDropZone(null);
      if (!dragged) return;
      e.preventDefault();
      latest.current.onMove(bodyDropToMove(dragged, latest.current.paneId, zoneAt(e)));
    };
    body.addEventListener('dragover', over);
    body.addEventListener('dragleave', leave);
    body.addEventListener('drop', drop);
    return () => {
      body.removeEventListener('dragover', over);
      body.removeEventListener('dragleave', leave);
      body.removeEventListener('drop', drop);
    };
  }, [body]);

  return { rootRef: setRoot, bodyRef: setBody, dropZone };
}
