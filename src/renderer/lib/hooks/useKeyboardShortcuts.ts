/**
 * APP_SHORTCUTS — central registry of keyboard shortcut metadata.
 *
 * `defaultHotkey` uses TanStack Hotkeys string format (e.g. 'Mod+K').
 * Defaults are resolved here in the renderer rather than in schema.ts because
 * some are platform-specific.
 *
 * All event handling is done in AppKeyboardShortcuts.tsx via useHotkey().
 */
import type { Hotkey } from '@tanstack/react-hotkeys';

export interface AppShortcutDef {
  defaultHotkey: string;
  label: string;
  description: string;
  category: string;
  hideFromSettings?: boolean;
}

type ShortcutOverrides = Partial<Record<ShortcutSettingsKey, string | null>>;

/**
 * Preserves literal key types for `keyof` inference while widening each value
 * to the full `AppShortcutDef` interface (so optional fields like
 * `hideFromSettings` are accessible on every entry without a union problem).
 */
function defineShortcuts<T extends Record<string, AppShortcutDef>>(
  shortcuts: T
): Record<keyof T, AppShortcutDef> {
  return shortcuts as Record<keyof T, AppShortcutDef>;
}

export const APP_SHORTCUTS = defineShortcuts({
  commandPalette: {
    defaultHotkey: 'Mod+K',
    label: 'Command Palette',
    description: 'Open the command palette to quickly search and navigate',
    category: 'Navigation',
  },
  fileFinder: {
    defaultHotkey: 'Mod+P',
    label: 'Go to File',
    description: 'Fuzzy-search files in the current work item and open one',
    category: 'Navigation',
  },
  settings: {
    defaultHotkey: 'Mod+,',
    label: 'Settings',
    description: 'Open application settings',
    category: 'Navigation',
  },
  toggleLeftSidebar: {
    defaultHotkey: 'Mod+B',
    label: 'Toggle Left Sidebar',
    description: 'Show or hide the left sidebar',
    category: 'View',
  },
  toggleRightSidebar: {
    defaultHotkey: 'Mod+.',
    label: 'Toggle Right Sidebar',
    description: 'Show or hide the right sidebar',
    category: 'View',
  },
  toggleTheme: {
    defaultHotkey: 'Mod+T',
    label: 'Toggle Theme',
    description: 'Cycle through light, dark navy, and dark black themes',
    category: 'View',
  },
  closeModal: {
    defaultHotkey: 'Escape',
    label: 'Close Modal',
    description: 'Close the current modal or dialog',
    category: 'Navigation',
    hideFromSettings: true,
  },
  nextWorkItem: {
    defaultHotkey: 'Mod+]',
    label: 'Next work item',
    description: 'Select the next work item in the sidebar',
    category: 'Navigation',
  },
  prevWorkItem: {
    defaultHotkey: 'Mod+[',
    label: 'Previous work item',
    description: 'Select the previous work item in the sidebar',
    category: 'Navigation',
  },
  newWorkItem: {
    defaultHotkey: 'Mod+N',
    label: 'New work item',
    description: 'Create a new work item',
    category: 'Navigation',
  },
  /**
   * Wired: picks a folder, `git init`s it (with an empty initial commit, so the
   * first work item has a ref to branch a worktree from) and adds it. This is
   * the one path that CREATES a repository — every other one only attaches a
   * folder that already is one.
   */
  newRepository: {
    defaultHotkey: 'Mod+Shift+N',
    label: 'New repository',
    description: 'Create a new repository from scratch',
    category: 'Navigation',
  },
  openInEditor: {
    defaultHotkey: 'Mod+O',
    label: 'Open in Editor',
    description: 'Open the project in the default editor',
    category: 'Navigation',
  },
  /**
   * Reserved, not built — and describing a layout that does not exist. These
   * three name a three-pane "task panel" (Conversations / Diff / Editor). The
   * centre pane is a TAB STRIP: one chat, one tab per terminal session, one
   * per open file (`features/work-list/center-tab.ts`), already served by
   * tabNext / tabPrev / tabClose. "Diff view" has no referent — there is no
   * single diff pane, there is one tab per file.
   */
  taskViewAgents: {
    defaultHotkey: 'Mod+Shift+1',
    label: 'Conversations view',
    description: 'Switch to the conversations view in the task panel',
    category: 'Task View',
    hideFromSettings: true,
  },
  taskViewDiff: {
    defaultHotkey: 'Mod+Shift+2',
    label: 'Diff view',
    description: 'Switch to the diff view in the task panel',
    category: 'Task View',
    hideFromSettings: true,
  },
  taskViewEditor: {
    defaultHotkey: 'Mod+Shift+3',
    label: 'Editor view',
    description: 'Switch to the editor view in the task panel',
    category: 'Task View',
    hideFromSettings: true,
  },
  tabNext: {
    defaultHotkey: 'Mod+Alt+ArrowRight',
    label: 'Next Tab',
    description: 'Switch to the next tab',
    category: 'Tab Navigation',
  },
  tabPrev: {
    defaultHotkey: 'Mod+Alt+ArrowLeft',
    label: 'Previous Tab',
    description: 'Switch to the previous tab',
    category: 'Tab Navigation',
  },
  tabClose: {
    defaultHotkey: 'Mod+W',
    label: 'Close Tab',
    description: 'Close the active tab',
    category: 'Tab Navigation',
  },
  /**
   * Reserved, not built. A work item has exactly ONE chat: the renderer models
   * it as a singleton tab carrying no sessionId (`center-tab.ts`), so a second
   * one is not representable. `agent_sessions` could hold more, but nothing in
   * the UI could address them.
   */
  newConversation: {
    defaultHotkey: 'Mod+Shift+C',
    label: 'New Conversation',
    description: 'Create a new conversation in the current task',
    category: 'Task View',
    hideFromSettings: true,
  },
  newTerminal: {
    defaultHotkey: 'Mod+Shift+T',
    label: 'New terminal',
    description: 'Open a new terminal session in the current work item',
    category: 'Work Item',
  },
  focusChat: {
    defaultHotkey: 'Mod+L',
    label: 'Focus chat',
    description: 'Move focus to the chat composer in the current work item',
    category: 'Work Item',
  },
  cycleEffort: {
    defaultHotkey: 'Mod+Alt+E',
    label: 'Cycle effort',
    description: "Step the focused composer's reasoning effort to the next level",
    category: 'Work Item',
  },
  confirm: {
    defaultHotkey: 'Mod+Enter',
    label: 'Confirm',
    description: 'Confirm the current dialog action',
    category: 'Navigation',
  },
});

/** All valid shortcut keys — inferred directly from the registry, never redeclared. */
export type ShortcutSettingsKey = keyof typeof APP_SHORTCUTS;

/**
 * Returns the currently assigned hotkey for an action.
 * - `undefined` override -> falls back to default
 * - `null` override -> unassigned (disabled)
 */
export function getEffectiveHotkey(
  key: ShortcutSettingsKey,
  custom?: ShortcutOverrides
): Hotkey | null {
  const configured = custom?.[key];
  if (configured === null) return null;
  return (configured ?? APP_SHORTCUTS[key].defaultHotkey) as Hotkey;
}

/**
 * Always returns a valid hotkey string for hook registration.
 * Pair this with `getEffectiveHotkey(...) !== null` in `enabled`.
 */
export function getHotkeyRegistration(
  key: ShortcutSettingsKey,
  custom?: ShortcutOverrides
): Hotkey {
  return (getEffectiveHotkey(key, custom) ?? APP_SHORTCUTS[key].defaultHotkey) as Hotkey;
}
