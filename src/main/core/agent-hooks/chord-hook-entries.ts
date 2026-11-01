import { makeClaudeHookCommand } from './agent-notify-command';

/**
 * What Chord hands an agent CLI so its lifecycle events reach the hook
 * server, and the checkout paths older builds wrote that config to.
 */

/** The Claude Code hook events Chord listens to, and their settings keys. */
export const CLAUDE_HOOK_EVENTS = [
  { eventType: 'notification', hookKey: 'Notification' },
  { eventType: 'stop', hookKey: 'Stop' },
] as const;

export type ClaudeHookKey = (typeof CLAUDE_HOOK_EVENTS)[number]['hookKey'];

export interface ClaudeHookEntry {
  hooks: { type: 'command'; command: string }[];
}

export function buildClaudeHookEntry(eventType: string): ClaudeHookEntry {
  return { hooks: [{ type: 'command', command: makeClaudeHookCommand(eventType) }] };
}

/** Chord's hooks as a Claude Code settings `hooks` block. */
export function buildClaudeHooks(): Record<ClaudeHookKey, ClaudeHookEntry[]> {
  return {
    Notification: [buildClaudeHookEntry('notification')],
    Stop: [buildClaudeHookEntry('stop')],
  };
}

/** Where builds before devstation-bmj merged Chord's Claude hooks. */
export const CLAUDE_LOCAL_SETTINGS_PATH = '.claude/settings.local.json';
/** Where builds before devstation-tx0 wrote Chord's Codex notify. */
export const CODEX_PROJECT_CONFIG_PATH = '.codex/config.toml';
/** Pi's extension: Pi still loads it from the checkout. */
export const PI_EXTENSION_PATH = '.pi/extensions/chord-hook.ts';

/** The exact lines older builds appended to the checkout's `.gitignore`. */
export const CHORD_GITIGNORE_ENTRIES: readonly string[] = [
  CLAUDE_LOCAL_SETTINGS_PATH,
  CODEX_PROJECT_CONFIG_PATH,
  PI_EXTENSION_PATH,
];
