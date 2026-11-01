import { describe, expect, it } from 'vitest';
import {
  bodyDropToMove,
  decodeTabDrag,
  encodeTabDrag,
  resolveDropZone,
  stripDropToMove,
} from './pane-drop-zone';

const rect = { left: 100, top: 50, width: 400, height: 200 };
const payload = { key: 'session:s1', fromPaneId: 'pane-0' };

describe('resolveDropZone', () => {
  it('reads the middle as center', () => {
    expect(resolveDropZone(rect, 300, 150)).toBe('center');
  });

  it('reads the right quarter as right', () => {
    expect(resolveDropZone(rect, 480, 100)).toBe('right');
  });

  it('reads the bottom quarter as bottom', () => {
    expect(resolveDropZone(rect, 200, 240)).toBe('bottom');
  });

  it('reads the left and top quarters as left and top', () => {
    expect(resolveDropZone(rect, 150, 150)).toBe('left');
    expect(resolveDropZone(rect, 300, 80)).toBe('top');
  });

  it('picks the nearer edge in the top-left corner', () => {
    expect(resolveDropZone(rect, 105, 80)).toBe('left');
    expect(resolveDropZone(rect, 150, 52)).toBe('top');
  });

  it('picks the nearer edge in the bottom-right corner', () => {
    expect(resolveDropZone(rect, 495, 220)).toBe('right');
    expect(resolveDropZone(rect, 430, 248)).toBe('bottom');
  });
});

describe('bodyDropToMove', () => {
  it('moves to the end of the pane on center', () => {
    expect(bodyDropToMove(payload, 'pane-1', 'center')).toEqual({
      key: 'session:s1',
      fromPaneId: 'pane-0',
      toPaneId: 'pane-1',
    });
  });

  it('maps each edge to a split direction and side', () => {
    const splitOf = (zone: 'left' | 'right' | 'top' | 'bottom') => {
      const { split, side } = bodyDropToMove(payload, 'pane-1', zone);
      return [split, side];
    };
    expect(splitOf('left')).toEqual(['horizontal', 'before']);
    expect(splitOf('right')).toEqual(['horizontal', 'after']);
    expect(splitOf('top')).toEqual(['vertical', 'before']);
    expect(splitOf('bottom')).toEqual(['vertical', 'after']);
  });
});

describe('stripDropToMove', () => {
  it('carries the target index', () => {
    expect(stripDropToMove(payload, 'pane-0', 2)).toEqual({
      ...payload,
      toPaneId: 'pane-0',
      toIndex: 2,
    });
  });
});

describe('tab drag payload', () => {
  it('round-trips', () => {
    expect(decodeTabDrag(encodeTabDrag(payload))).toEqual(payload);
  });

  it('rejects an empty or foreign payload', () => {
    expect(decodeTabDrag('')).toBeNull();
    expect(decodeTabDrag('{"key":1}')).toBeNull();
  });
});
