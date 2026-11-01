import type { MoveTabRequest } from './center-layout-split';

/** `dataTransfer` type for a centre tab being dragged; other drags are ignored. */
export const TAB_DRAG_TYPE = 'application/x-chord-center-tab';

export interface TabDragPayload {
  /** `centerTabKey` of the dragged tab. */
  key: string;
  fromPaneId: string;
}

/** Both React's and the DOM's drag events: all the tab drag helpers read. */
interface DragEventLike {
  dataTransfer: DataTransfer | null;
}

export function isTabDrag(e: DragEventLike): boolean {
  return e.dataTransfer?.types.includes(TAB_DRAG_TYPE) ?? false;
}

export function readTabDrag(e: DragEventLike): TabDragPayload | null {
  if (!e.dataTransfer || !isTabDrag(e)) return null;
  return decodeTabDrag(e.dataTransfer.getData(TAB_DRAG_TYPE));
}

/** Where over a pane body a tab would land: the middle, or an edge that splits the pane. */
export type PaneDropZone = 'center' | 'left' | 'right' | 'top' | 'bottom';

/** Fraction of the pane's width or height that counts as an edge. */
export const EDGE_FRACTION = 0.25;

export function encodeTabDrag(payload: TabDragPayload): string {
  return JSON.stringify(payload);
}

export function decodeTabDrag(data: string): TabDragPayload | null {
  if (!data) return null;
  const parsed: unknown = JSON.parse(data);
  if (typeof parsed !== 'object' || parsed === null) return null;
  const { key, fromPaneId } = parsed as Record<string, unknown>;
  return typeof key === 'string' && typeof fromPaneId === 'string' ? { key, fromPaneId } : null;
}

/** The zone under a point, given the pane body's client rect. The nearest edge wins in a corner. */
export function resolveDropZone(
  rect: { left: number; top: number; width: number; height: number },
  x: number,
  y: number
): PaneDropZone {
  const distances: [PaneDropZone, number][] = [
    ['left', (x - rect.left) / rect.width],
    ['right', (rect.left + rect.width - x) / rect.width],
    ['top', (y - rect.top) / rect.height],
    ['bottom', (rect.top + rect.height - y) / rect.height],
  ];
  const [zone, distance] = distances.reduce((nearest, next) =>
    next[1] < nearest[1] ? next : nearest
  );
  return distance <= EDGE_FRACTION ? zone : 'center';
}

/** A drop on a pane body: the centre appends to that pane's strip, an edge splits beside it. */
export function bodyDropToMove(
  payload: TabDragPayload,
  toPaneId: string,
  zone: PaneDropZone
): MoveTabRequest {
  const move: MoveTabRequest = { key: payload.key, fromPaneId: payload.fromPaneId, toPaneId };
  switch (zone) {
    case 'left':
      return { ...move, split: 'horizontal', side: 'before' };
    case 'right':
      return { ...move, split: 'horizontal', side: 'after' };
    case 'top':
      return { ...move, split: 'vertical', side: 'before' };
    case 'bottom':
      return { ...move, split: 'vertical', side: 'after' };
    case 'center':
      return move;
  }
}

/** A drop on a strip tab: the dragged tab takes that tab's position. */
export function stripDropToMove(
  payload: TabDragPayload,
  toPaneId: string,
  toIndex: number
): MoveTabRequest {
  return { key: payload.key, fromPaneId: payload.fromPaneId, toPaneId, toIndex };
}
