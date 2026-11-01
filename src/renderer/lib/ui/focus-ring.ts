/**
 * The app's keyboard-focus treatment, as used by `McpModal`, `IntegrationRow`,
 * `ThemeCard` and `CliAgentsList`. Compose it with `cn()` on any interactive
 * element that isn't already getting a ring from a primitive.
 *
 * `focus-visible` (not `focus`) so a mouse click doesn't leave a ring behind.
 */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-selected-border focus-visible:ring-offset-2 focus-visible:ring-offset-surface';
