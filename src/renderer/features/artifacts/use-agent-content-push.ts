import type { HocuspocusProvider } from '@hocuspocus/provider';
import type { Editor } from '@tiptap/react';
import { useCallback, useEffect, useState } from 'react';
import {
  artifactContentUpdateChannel,
  type ArtifactContentUpdate,
} from '@shared/events/artifactEvents';
import { artifactCloudApi } from '@renderer/features/artifacts/cloud/artifact-cloud-api';
import { toast } from '@renderer/lib/hooks/use-toast';
import { events } from '@renderer/lib/ipc';
import { agentMilestoneForApply, type AgentContentApply } from './agent-milestone';
import type { ArtifactSource } from './artifact-surface';
import { waitForCollabFlush } from './collab-flush';
import { markdownToHtml } from './markdown';

// How long the agent's write may take to reach the collab server before the
// milestone is reported as not saved.
const MILESTONE_FLUSH_TIMEOUT_MS = 10_000;

export interface PendingAgentUpdate {
  artifactId: string;
  filePath: string;
  html: string;
}

export interface AgentContentPush {
  pendingUpdate: PendingAgentUpdate | null;
  applyPendingUpdate: () => void;
  dismissPendingUpdate: () => void;
}

interface AgentContentPushOptions {
  /** Only the author's editor (source `local`) receives agent writes. */
  enabled: boolean;
  source: ArtifactSource;
  workItemId: string | undefined;
  provider: HocuspocusProvider | null;
}

function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Records the cloud `agent_milestone` version for an agent write that just
 * landed in the live document (design 2026-09-24 §9 decision 4). The server
 * snapshots its own Yjs state, so the write is flushed to it first. A failure
 * is shown — the history would otherwise silently miss the agent's version.
 */
async function recordAgentMilestone(
  options: AgentContentPushOptions,
  artifactId: string,
  apply: AgentContentApply
): Promise<void> {
  const milestone = agentMilestoneForApply({ source: options.source, apply });
  if (!milestone) return;
  try {
    if (!options.workItemId) throw new Error('the document has no work item');
    if (!options.provider) throw new Error('the document is not connected to the collab server');
    await waitForCollabFlush(options.provider, MILESTONE_FLUSH_TIMEOUT_MS);
    await artifactCloudApi.saveVersion(options.workItemId, artifactId, milestone);
  } catch (e) {
    const description = `The agent's update was applied but not saved as a version: ${describe(e)}`;
    console.error(`[versions] ${description}`);
    toast({ title: 'Agent version not saved', description, variant: 'destructive' });
  }
}

/**
 * Relays agent file writes into the artifact document.
 *
 * The collaborative document is the source of truth for artifact content, so a
 * file write replaces it directly only while the document is still empty — the
 * agent's initial generation. Once the document has content, the write is held
 * as a pending update for the user to apply, because a whole-document replace
 * would discard concurrent typing here and broadcast that loss to every peer.
 * Either way, content that lands records an agent milestone version.
 */
export function useAgentContentPush(
  editor: Editor | null,
  artifactId: string | undefined,
  isDocumentEmpty: () => boolean,
  options: AgentContentPushOptions
): AgentContentPush {
  const [pending, setPending] = useState<PendingAgentUpdate | null>(null);
  const { enabled, source, workItemId, provider } = options;

  // Tagged with the artifact it came from, so switching artifacts drops a stale
  // pending update instead of offering it against the wrong document.
  const pendingUpdate = pending && pending.artifactId === artifactId ? pending : null;

  useEffect(() => {
    if (!enabled || !editor || !artifactId) return;

    const off = events.on(artifactContentUpdateChannel, (event: ArtifactContentUpdate) => {
      if (event.artifactId !== artifactId) return;
      const html = markdownToHtml(event.content);
      if (isDocumentEmpty()) {
        editor.commands.setContent(html);
        void recordAgentMilestone(
          { enabled, source, workItemId, provider },
          artifactId,
          'auto-into-empty'
        );
        return;
      }
      setPending({ artifactId, filePath: event.filePath, html });
    });

    return off;
  }, [enabled, editor, artifactId, isDocumentEmpty, source, workItemId, provider]);

  const applyPendingUpdate = useCallback(() => {
    if (!editor || editor.isDestroyed || !pendingUpdate) return;
    editor.commands.setContent(pendingUpdate.html);
    setPending(null);
    void recordAgentMilestone(
      { enabled, source, workItemId, provider },
      pendingUpdate.artifactId,
      'banner'
    );
  }, [editor, pendingUpdate, enabled, source, workItemId, provider]);

  const dismissPendingUpdate = useCallback(() => {
    setPending(null);
  }, []);

  return { pendingUpdate, applyPendingUpdate, dismissPendingUpdate };
}
