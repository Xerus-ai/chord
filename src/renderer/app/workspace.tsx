import { CommandPalette } from '@renderer/features/command-palette/command-palette';
import { SettingsSidebar } from '@renderer/features/settings/components/SettingsSidebar';
import { AppKeyboardShortcuts } from '@renderer/lib/components/app-keyboard-shortcuts';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import {
  isCurrentView,
  useViewLayoutOverride,
  useWorkspaceSlots,
  useWorkspaceWrapParams,
} from '@renderer/lib/layout/navigation-provider';
import { WorkspaceContentLayout, WorkspaceLayout } from '@renderer/lib/layout/workspace-layout';
import { ModalRenderer } from '@renderer/lib/modal/modal-renderer';
import { Toaster } from '@renderer/lib/ui/toaster';

interface WorkspaceProps {
  /** Owned by the app shell so the top bar's search button can open the
   *  palette through state instead of synthesizing a Ctrl+K keydown. */
  commandPaletteOpen: boolean;
  onCommandPaletteOpenChange: (open: boolean) => void;
  /** The app sidebar, hosted in the collapsible left panel so Mod+B works. */
  leftSidebar: React.ReactNode;
}

export function Workspace({
  commandPaletteOpen,
  onCommandPaletteOpenChange,
  leftSidebar,
}: WorkspaceProps) {
  useTheme();
  const { WrapView, currentView } = useWorkspaceSlots();
  const { wrapParams } = useWorkspaceWrapParams();
  // Settings replaces the sessions rail with its own: same
  // column, same width, so the main pane never moves. Keyed so the incoming
  // rail plays its slide-in; the outgoing one unmounts.
  const inSettings = isCurrentView(currentView, 'settings');
  const rail = (
    <div key={inSettings ? 'settings' : 'app'} className="animate-rail-in h-full min-h-0 w-full">
      {inSettings ? <SettingsSidebar /> : leftSidebar}
    </div>
  );
  return (
    <>
      <AppKeyboardShortcuts onOpenCommandPalette={() => onCommandPaletteOpenChange(true)} />
      <CommandPalette open={commandPaletteOpen} onOpenChange={onCommandPaletteOpenChange} />
      <WorkspaceLayout
        leftSidebar={rail}
        mainContent={
          <WrapView {...wrapParams}>
            <ModalRenderer />
            <WorkspaceViewContent />
          </WrapView>
        }
      />
      <Toaster />
    </>
  );
}

function WorkspaceViewContent() {
  const { TitlebarSlot, MainPanel, RightPanel } = useWorkspaceSlots();
  const { hideRightPanel } = useViewLayoutOverride();
  const EffectiveRightPanel = hideRightPanel ? null : RightPanel;
  return (
    <WorkspaceContentLayout
      titlebarSlot={<TitlebarSlot />}
      mainPanel={<MainPanel />}
      rightPanel={EffectiveRightPanel ? <EffectiveRightPanel /> : null}
    />
  );
}
