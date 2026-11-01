import { useHotkey } from '@tanstack/react-hotkeys';
import { useEffect } from 'react';
import { createRepositoryFromFolder } from '@renderer/features/settings/create-repository';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  getEffectiveHotkey,
  getHotkeyRegistration,
} from '@renderer/lib/hooks/useKeyboardShortcuts';
import { useTheme } from '@renderer/lib/hooks/useTheme';
import { useWorkspaceLayoutContext } from '@renderer/lib/layout/layout-provider';
import { useNavigate, useParams } from '@renderer/lib/layout/navigation-provider';

export function AppKeyboardShortcuts({
  onOpenCommandPalette,
}: {
  onOpenCommandPalette: () => void;
}) {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const { toggleLeft, toggleRight } = useWorkspaceLayoutContext();
  const { toggleTheme } = useTheme();
  const { navigate } = useNavigate();
  const { params } = useParams('work-list');
  const commandPaletteHotkey = getEffectiveHotkey('commandPalette', keyboard);
  const settingsHotkey = getEffectiveHotkey('settings', keyboard);
  const toggleLeftSidebarHotkey = getEffectiveHotkey('toggleLeftSidebar', keyboard);
  const toggleRightSidebarHotkey = getEffectiveHotkey('toggleRightSidebar', keyboard);
  const toggleThemeHotkey = getEffectiveHotkey('toggleTheme', keyboard);
  const newWorkItemHotkey = getEffectiveHotkey('newWorkItem', keyboard);
  const newRepositoryHotkey = getEffectiveHotkey('newRepository', keyboard);
  const nextWorkItemHotkey = getEffectiveHotkey('nextWorkItem', keyboard);
  const prevWorkItemHotkey = getEffectiveHotkey('prevWorkItem', keyboard);
  const newTerminalHotkey = getEffectiveHotkey('newTerminal', keyboard);
  const focusChatHotkey = getEffectiveHotkey('focusChat', keyboard);

  useHotkey(getHotkeyRegistration('commandPalette', keyboard), () => onOpenCommandPalette(), {
    enabled: commandPaletteHotkey !== null,
  });

  // The palette's open state lives in App.tsx and reaches exactly one place:
  // here. The sidebar's search box needs the same door, so it knocks on this
  // one rather than growing a second search of its own.
  useEffect(() => {
    const handler = () => onOpenCommandPalette();
    window.addEventListener('chord:open-command-palette', handler);
    return () => window.removeEventListener('chord:open-command-palette', handler);
  }, [onOpenCommandPalette]);

  useHotkey(getHotkeyRegistration('settings', keyboard), () => navigate('settings'), {
    enabled: settingsHotkey !== null,
  });

  useHotkey(getHotkeyRegistration('toggleLeftSidebar', keyboard), () => toggleLeft(), {
    enabled: toggleLeftSidebarHotkey !== null,
  });

  useHotkey(getHotkeyRegistration('toggleRightSidebar', keyboard), () => toggleRight(), {
    enabled: toggleRightSidebarHotkey !== null,
  });

  useHotkey(getHotkeyRegistration('toggleTheme', keyboard), () => toggleTheme(), {
    enabled: toggleThemeHotkey !== null,
  });

  // Creating and cycling work items are handled by AppSidebar, which is
  // mounted unconditionally (App.tsx:66) and already owns both the create
  // modal and the sorted list. Dispatching at it rather than acting here is
  // what makes these work from any view — the work-list panel these used to
  // be routed through only exists while a work item is open.
  useHotkey(
    getHotkeyRegistration('newWorkItem', keyboard),
    () => window.dispatchEvent(new CustomEvent('chord:create-work-item')),
    { enabled: newWorkItemHotkey !== null }
  );

  // Acts directly rather than dispatching at a mounted component: creating a
  // repository is a folder picker and an RPC, with no UI state to own.
  useHotkey(
    getHotkeyRegistration('newRepository', keyboard),
    () => void createRepositoryFromFolder(),
    { enabled: newRepositoryHotkey !== null }
  );

  useHotkey(
    getHotkeyRegistration('nextWorkItem', keyboard),
    () => window.dispatchEvent(new CustomEvent('chord:cycle-work-item', { detail: 'next' })),
    { enabled: nextWorkItemHotkey !== null }
  );

  useHotkey(
    getHotkeyRegistration('prevWorkItem', keyboard),
    () => window.dispatchEvent(new CustomEvent('chord:cycle-work-item', { detail: 'prev' })),
    { enabled: prevWorkItemHotkey !== null }
  );

  // A terminal belongs to a work item, so this one stays genuinely scoped:
  // its listener lives in the work-item panel. Gating registration on an open
  // work item is the difference between "not applicable here" and a key that
  // fires into nothing.
  useHotkey(
    getHotkeyRegistration('newTerminal', keyboard),
    () => window.dispatchEvent(new CustomEvent('chord:create-terminal')),
    { enabled: newTerminalHotkey !== null && params.workItemId != null }
  );

  // The composer hint advertised "⌘L to focus" while Mod+L was bound to
  // nothing — the only route to chord:focus-chat was the palette. Same work
  // item gating as the terminal: there is no composer to focus without one.
  useHotkey(
    getHotkeyRegistration('focusChat', keyboard),
    () => window.dispatchEvent(new CustomEvent('chord:focus-chat')),
    { enabled: focusChatHotkey !== null && params.workItemId != null }
  );

  return null;
}
