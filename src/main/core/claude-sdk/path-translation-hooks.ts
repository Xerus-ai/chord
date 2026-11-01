import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { log } from '@main/lib/logger';
import { normalizeToolInputPaths } from './normalize-tool-input-paths';

/**
 * Windows only. The CLI runs its shell tool under Git Bash, so a model that
 * asks the shell where it is gets a POSIX rendering of the workspace
 * (`/c/repo`, or `/tmp/...` for a repo under `%TEMP%`) and then hands that
 * string to Write/Edit/Read. Node resolves the leading slash against the
 * current drive, so the write silently lands in a `C:\tmp\...` mirror instead
 * of the repo. PreToolUse is the only seam that sees every tool call — the
 * permission gate is skipped once a tool is always-allowed — so the
 * translation back to real Windows paths happens here, before the tool runs.
 */
export function buildPathTranslationHooks(
  cwd: string
): Partial<Record<'PreToolUse', HookCallbackMatcher[]>> {
  if (process.platform !== 'win32') return {};

  return {
    PreToolUse: [
      {
        hooks: [
          async (input): Promise<HookJSONOutput> => {
            if (input.hook_event_name !== 'PreToolUse') return {};
            const toolInput = input.tool_input;
            if (typeof toolInput !== 'object' || toolInput === null) return {};

            const updatedInput = normalizeToolInputPaths(
              input.tool_name,
              toolInput as Record<string, unknown>,
              cwd
            );
            if (!updatedInput) return {};

            log.info('claude-sdk-session: translated POSIX tool path to Windows', {
              tool: input.tool_name,
            });
            return { hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput } };
          },
        ],
      },
    ],
  };
}
