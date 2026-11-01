import { formatForDisplay } from '@tanstack/react-hotkeys';
import { Plus } from 'lucide-react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { getEffectiveHotkey } from '@renderer/lib/hooks/useKeyboardShortcuts';

/**
 * The full-width "New work item" button per the prototype's `.new`: bordered,
 * 38px, with the effective hotkey shown in mono on the right — read from
 * `useKeyboardShortcuts`, never hardcoded, so a rebind or a disabled shortcut
 * is reflected here too.
 */
export function SidebarNewWorkItemButton({ onClick }: { onClick: () => void }) {
  const { value: keyboard } = useAppSettingsKey('keyboard');
  const hotkey = getEffectiveHotkey('newWorkItem', keyboard);

  return (
    <button
      type="button"
      onClick={onClick}
      className="mx-2 mb-1.5 mt-0.5 flex h-[38px] shrink-0 items-center gap-2 rounded-md border border-border bg-surface-hover px-3 text-list-row font-medium text-text transition-colors hover:bg-surface-inset"
    >
      <Plus className="size-icon-md text-text-passive" strokeWidth={1.75} />
      <span className="flex-1 truncate text-left">New work item</span>
      {hotkey && (
        <span className="text-list-meta tracking-tiny font-mono text-text-passive">
          {formatForDisplay(hotkey)}
        </span>
      )}
    </button>
  );
}
