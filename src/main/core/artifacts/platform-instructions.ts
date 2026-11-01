/**
 * The one line Chord adds to a new session's first prompt. Format guidance and
 * the user's preferred format ride on the `publish_artifact` tool description
 * (`agent-artifact-tools/artifact-tool-guidance.ts`), so this only points at
 * the tool — and only when the session actually has it. A session without the
 * tool is told nothing about artifacts.
 */
const PUBLISH_TOOL_POINTER =
  'You are working inside Chord. To share a plan, report, page or prototype with the team, write the file in the workspace, then publish it with the chord publish_artifact tool.';

export function prependPlatformContext(
  prompt: string,
  options: { publishToolAvailable: boolean }
): string {
  if (!options.publishToolAvailable) return prompt;
  return `${PUBLISH_TOOL_POINTER}\n\n${prompt}`;
}
