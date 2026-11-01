import type { HookCallbackMatcher, HookJSONOutput } from '@anthropic-ai/claude-agent-sdk';
import { listWorkItemArtifactRows } from '@main/core/artifacts/find-artifact-by-path';
import {
  DocumentWriteRecorder,
  toolLocationsFromRawInput,
} from '@main/core/chat-messages/record-document-writes';
import { log } from '@main/lib/logger';

/**
 * The publish nudge (plan 2026-09-23 §4 P4 step 1), given on the write: the
 * first time the session writes a document that is not an artifact, the tool
 * result carries a note asking the agent to publish it if it is a deliverable,
 * so the agent decides while it is still working instead of leaving it to the
 * chips. ACP agents have no such hook and get the chips only.
 *
 * It used to block the turn's Stop with the turn's list. A blocked stop makes
 * the agent reply again, so every file-writing turn ended twice ("OK", "OK"),
 * or with an explanation of why the file was not published
 * (devstation-fo4u). A note on the tool result reaches the agent before its
 * reply, and the turn ends once.
 */
export function buildPublishNudgeHooks(args: {
  workItemId: string;
  cwd: string;
  // `Stop` is in the type and never set: the nudge never blocks a turn's end.
}): Partial<Record<'PostToolUse' | 'Stop', HookCallbackMatcher[]>> {
  const writes = new DocumentWriteRecorder();
  writes.setWorkspaceDir(args.cwd);
  const asked = new Set<string>();

  return {
    PostToolUse: [
      {
        hooks: [
          async (input): Promise<HookJSONOutput> => {
            if (input.hook_event_name !== 'PostToolUse') return {};
            const locations = toolLocationsFromRawInput(
              typeof input.tool_input === 'object' && input.tool_input !== null
                ? (input.tool_input as Record<string, unknown>)
                : undefined
            );
            // A call that touched no file has nothing new to ask about.
            if (!locations) return {};
            writes.recordToolLocations(input.tool_name, locations);
            const existing = new Set(
              listWorkItemArtifactRows(args.workItemId).map((row) => row.filePath)
            );
            const unasked = writes
              .takeUnpublishedDocuments(existing)
              .filter((filePath) => !asked.has(filePath));
            if (unasked.length === 0) return {};
            for (const filePath of unasked) asked.add(filePath);

            log.info('claude-sdk: publish nudge on write', {
              workItemId: args.workItemId,
              files: unasked,
            });
            return {
              hookSpecificOutput: {
                hookEventName: 'PostToolUse',
                additionalContext: describeUnpublished(unasked),
              },
            };
          },
        ],
      },
    ],
  };
}

function describeUnpublished(files: string[]): string {
  return [
    'Chord: you wrote these documents, which are not Chord artifacts:',
    ...files.map((file) => `- ${file}`),
    'If one is a deliverable the team will come back to (a plan, spec, report or brief), publish it with the publish_artifact tool once it is finished; if you change it after that, publishing it again updates it. Otherwise carry on and finish without mentioning publishing or these files: the user did not ask about them.',
  ].join('\n');
}
