import { Copy, GitCommitHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { ChromeTab } from '@renderer/lib/components/chrome/chrome-tabs';
import { FileIcon } from '@renderer/lib/editor/file-icon';
import { ContextMenuItem, ContextMenuSeparator } from '@renderer/lib/ui/context-menu';
import { centerTabsEqual, type DocumentTab } from './center-tab';
import type { PaneTabsController } from './center-tabs-store';

function tabLabel(tab: DocumentTab): string {
  return tab.kind === 'commit' ? tab.sha.slice(0, 7) : tab.title;
}

function tabTitle(tab: DocumentTab): string {
  if (tab.kind === 'commit') return `Commit ${tab.sha}`;
  return tab.filePath ?? tab.title;
}

/** The file type's icon; a path tab's mode shows in its file bar, not here. */
function TabIcon({ tab }: { tab: DocumentTab }) {
  if (tab.kind === 'commit') return <GitCommitHorizontal className="size-icon-sm" />;
  return <FileIcon filename={tab.filePath ?? tab.title} size={14} className="size-icon-sm" />;
}

/** One document tab (a path, file or artifact, or a commit) with its close menu. */
export function DocumentStripTab({
  tab,
  index,
  count,
  controller,
  missing,
  extraMenu,
}: {
  tab: DocumentTab;
  /** Position among the strip's document tabs, for the close-left/right menu. */
  index: number;
  count: number;
  controller: PaneTabsController;
  missing?: boolean;
  /** Extra context menu items, e.g. split and open-to-side in a centre pane. */
  extraMenu?: ReactNode;
}) {
  const label = tabLabel(tab);
  return (
    <ChromeTab
      icon={<TabIcon tab={tab} />}
      label={label}
      title={tabTitle(tab)}
      active={controller.active !== null && centerTabsEqual(controller.active, tab)}
      preview={tab.isPreview}
      missingLabel={missing ? 'deleted' : undefined}
      onClick={() => controller.activate(tab)}
      onDoubleClick={() => controller.promote(tab)}
      onClose={() => controller.close(tab)}
      closeLabel={`Close ${label}`}
      contextMenu={
        <>
          <ContextMenuItem onClick={() => controller.close(tab)}>Close</ContextMenuItem>
          <ContextMenuItem disabled={count < 2} onClick={() => controller.closeOthers(tab)}>
            Close Others
          </ContextMenuItem>
          <ContextMenuItem
            disabled={index === count - 1}
            onClick={() => controller.closeToRight(tab)}
          >
            Close to the Right
          </ContextMenuItem>
          <ContextMenuItem disabled={index === 0} onClick={() => controller.closeToLeft(tab)}>
            Close to the Left
          </ContextMenuItem>
          <ContextMenuItem onClick={controller.closeAll}>Close All</ContextMenuItem>
          {tab.kind === 'path' && tab.filePath !== undefined && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem
                onClick={() => void navigator.clipboard.writeText(tab.filePath as string)}
              >
                <Copy />
                Copy Path
              </ContextMenuItem>
            </>
          )}
          {extraMenu}
        </>
      }
    />
  );
}
