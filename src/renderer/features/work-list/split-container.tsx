import type { ReactNode } from 'react';
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@renderer/lib/ui/resizable';
import type { CenterLayoutNode, CenterPane } from './center-layout';
import { PANE_MIN_HEIGHT, PANE_MIN_WIDTH } from './center-pane-width';

/**
 * Renders the centre's split tree: each split is a resizable group of its two
 * children, each leaf is `renderPane`. Sizes are read once as defaults and
 * written back when a drag settles, so the store stays the source of truth
 * across restarts without fighting the library mid-drag.
 */
export function SplitContainer({
  node,
  renderPane,
  onResize,
}: {
  node: CenterLayoutNode;
  renderPane: (pane: CenterPane) => ReactNode;
  onResize: (splitId: string, sizes: [number, number]) => void;
}) {
  if (node.kind === 'pane') return renderPane(node);
  const [first, second] = node.children;
  const firstId = `${node.id}-${first.id}`;
  const secondId = `${node.id}-${second.id}`;
  // Both axes get a pixel floor, because pane chrome costs pixels rather than
  // percentages: a percentage minimum shrinks a pane until its tab strip and
  // composer no longer fit inside it, and the pane clips them.
  const minSize = node.direction === 'horizontal' ? `${PANE_MIN_WIDTH}px` : `${PANE_MIN_HEIGHT}px`;

  return (
    <ResizablePanelGroup
      id={node.id}
      orientation={node.direction}
      className="min-h-0 min-w-0 flex-1"
      onLayoutChanged={(layout) => {
        const a = layout[firstId];
        const b = layout[secondId];
        if (a === undefined || b === undefined) return;
        // Skip the settle that only reports the sizes the split was mounted with.
        if (Math.abs(a - node.sizes[0]) < 0.01 && Math.abs(b - node.sizes[1]) < 0.01) return;
        onResize(node.id, [a, b]);
      }}
    >
      <ResizablePanel id={firstId} defaultSize={`${node.sizes[0]}%`} minSize={minSize}>
        <SplitContainer node={first} renderPane={renderPane} onResize={onResize} />
      </ResizablePanel>
      <ResizableHandle />
      <ResizablePanel id={secondId} defaultSize={`${node.sizes[1]}%`} minSize={minSize}>
        <SplitContainer node={second} renderPane={renderPane} onResize={onResize} />
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}
