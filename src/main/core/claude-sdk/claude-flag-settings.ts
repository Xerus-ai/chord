import type { Settings } from '@anthropic-ai/claude-agent-sdk';

/**
 * The flag-layer settings a Chord Claude session launches with (`query({
 * settings })`, the `--settings` layer). Nothing here is ever written to the
 * user's own Claude config: a plain `claude` in a terminal keeps its defaults.
 *
 * - `fastMode` has no dedicated query option.
 * - `enableArtifact: false` turns off Claude Code's built-in Artifact tool so
 *   Chord's `publish_artifact` is the one publish path. Off at the
 *   `--settings` level wins over user settings (`sdk.d.ts` `enableArtifact`).
 *   Applied only while "Let agents create artifacts" is on; with it off the
 *   built-in tool is left to the user's Claude settings.
 */
export function buildClaudeFlagSettings(options: {
  fast: boolean;
  chordArtifactsEnabled: boolean;
}): Settings | undefined {
  const settings: Settings = {
    ...(options.fast ? { fastMode: true } : {}),
    ...(options.chordArtifactsEnabled ? { enableArtifact: false } : {}),
  };
  return Object.keys(settings).length > 0 ? settings : undefined;
}
