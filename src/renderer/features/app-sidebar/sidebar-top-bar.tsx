import { formatForDisplay } from '@tanstack/react-hotkeys';
import { Bell, LayoutGrid, Search } from 'lucide-react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { ChordMark } from '@renderer/lib/components/chord-mark';
import { useMacWindowButtonsShown } from '@renderer/lib/hooks/use-mac-window-buttons-shown';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';
import {
  isCurrentView,
  useNavigate,
  useWorkspaceSlots,
} from '@renderer/lib/layout/navigation-provider';
import { cn } from '@renderer/utils/utils';

const iconButton =
  'relative flex size-[34px] shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text';

/**
 * Restoration of the pre-Stage-3 `TopBar` (deleted in 7e0890d): a bare 44px
 * row of three icons — Dashboard, Search, Notifications — above the New work
 * item button, per the approved prototype's `.top`/`.tb`, led by the Chord mark
 * (brand only, not a button — Dashboard already sits beside it). Nothing else in the
 * shell defines a window drag region, so this bar carries it, as the
 * original did.
 */
export function SidebarTopBar({
  onOpenSearch,
  onToggleNotifications,
  hasUnreadNotifications,
}: {
  onOpenSearch: () => void;
  onToggleNotifications: () => void;
  hasUnreadNotifications: boolean;
}) {
  const { navigate } = useNavigate();
  const { currentView } = useWorkspaceSlots();
  const dashboardActive = isCurrentView(currentView, 'dashboard');
  const macWindowButtonsShown = useMacWindowButtonsShown();

  // Was hardcoded "Search (Ctrl K)" upstream — wrong on macOS, and blind to a
  // rebind. Read the effective hotkey instead.
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const paletteHotkey = getEffectiveHotkey('commandPalette', keyboard);
  const searchTitle = paletteHotkey ? `Search (${formatForDisplay(paletteHotkey)})` : 'Search';

  return (
    <div
      // 76px clears the macOS window buttons: three 12px buttons from x=14 (window.ts).
      className={cn(
        'flex h-11 shrink-0 items-center gap-0.5 px-2',
        macWindowButtonsShown && 'pl-[76px]'
      )}
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <ChordMark className="mx-1.5 size-6 shrink-0" />

      <button
        type="button"
        aria-label="Dashboard"
        title="Dashboard"
        onClick={() => navigate('dashboard')}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={cn(iconButton, dashboardActive && 'bg-surface-active text-text')}
      >
        <LayoutGrid className="size-[18px]" strokeWidth={dashboardActive ? 2.25 : 2} />
      </button>

      <button
        type="button"
        aria-label={searchTitle}
        title={searchTitle}
        onClick={onOpenSearch}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={iconButton}
      >
        <Search className="size-[18px]" strokeWidth={2} />
      </button>

      <button
        type="button"
        aria-label="Notifications"
        title="Notifications"
        onClick={onToggleNotifications}
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        className={iconButton}
      >
        <Bell className="size-[18px]" strokeWidth={2} />
        {hasUnreadNotifications && (
          <span className="absolute right-[6px] top-[6px] size-2 rounded-full bg-status-running ring-2 ring-surface" />
        )}
      </button>
    </div>
  );
}
