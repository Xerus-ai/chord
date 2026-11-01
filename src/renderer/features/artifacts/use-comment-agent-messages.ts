import { useCallback } from 'react';
import type { PickedElement } from '@shared/artifact-frame-messages';
import { rpc } from '@renderer/lib/ipc';
import { reportCommentFailure } from './comment-failure';
import {
  describeCommentAnchorForAgent,
  type CommentAnchorStatus,
} from './page/comment-anchor-status';
import { describePickedElementForAgent } from './page/picked-element';

/** What a message needs of a thread (use-comments' CommentThread has it). */
interface AgentThread {
  root: {
    body: string;
    anchor_key: string | null;
    anchor_text: string | null;
    anchorStatus: CommentAnchorStatus;
    resolved: boolean;
  };
}

function describeRpcError(error: { type: string; message?: string }): string {
  return error.message ?? error.type;
}

/**
 * An artifact's comments sent to the agent as chat messages: every unresolved
 * thread, one thread, a document selection, or an element picked in a page.
 * Each message names the artifact's own file; a step that fails is reported.
 */
export function useCommentAgentMessages({
  artifactId,
  workItemId,
  senderName,
  threads,
}: {
  artifactId: string;
  workItemId: string;
  senderName: string | null;
  threads: readonly AgentThread[];
}) {
  /**
   * Composes an agent message that references the artifact's own file, then
   * sends it. Every step that can fail — reading the artifact, the agent
   * launch itself — is reported instead of leaving a button that did nothing.
   */
  const sendToAgent = useCallback(
    async (action: string, compose: (fileRef: string) => string) => {
      try {
        if (!senderName) throw new Error('no signed-in account to send as');

        const artifact = await rpc.artifacts.get(artifactId);
        if (!artifact.success) {
          throw new Error(`artifact could not be read: ${artifact.error.type}`);
        }
        const filePath = artifact.data.artifact.filePath || artifact.data.artifact.name;

        const result = await rpc.chatMessages.sendToAgent({
          workItemId,
          content: compose(filePath),
          senderName,
        });
        if (!result.success) throw new Error(describeRpcError(result.error));
      } catch (e) {
        reportCommentFailure(action, e);
      }
    },
    [artifactId, workItemId, senderName]
  );

  const addAllToChat = useCallback(async () => {
    const unresolved = threads.filter((t) => !t.root.resolved);
    if (unresolved.length === 0) return;

    const lines = unresolved.map(
      ({ root }) =>
        `- ${describeCommentAnchorForAgent(root.anchor_key, root.anchor_text, root.anchorStatus)}${root.body}`
    );

    await sendToAgent(
      'Adding comments to chat',
      (filePath) =>
        `Here are the unresolved comments on file \`${filePath}\`:\n${lines.join('\n')}\n\nPlease address these comments by editing the file directly.`
    );
  }, [threads, sendToAgent]);

  const sendThreadToAgent = useCallback(
    async (thread: AgentThread) => {
      const { root } = thread;
      const anchor = describeCommentAnchorForAgent(
        root.anchor_key,
        root.anchor_text,
        root.anchorStatus
      );
      await sendToAgent(
        'Sending comment to agent',
        (filePath) =>
          `Comment in file \`${filePath}\`:\n- ${anchor}${thread.root.body}\n\nPlease address this comment by editing the file directly.`
      );
    },
    [sendToAgent]
  );

  const sendSelectionToAgent = useCallback(
    async ({ selection, instruction }: { selection: string; instruction: string }) => {
      await sendToAgent(
        'Sending selection to agent',
        (filePath) =>
          `On "${selection}" in file \`${filePath}\`: ${instruction}\n\nPlease apply this by editing the file directly.`
      );
    },
    [sendToAgent]
  );

  /** Edit with agent (plan P1b step 3): an element picked in a page, and what to do with it. */
  const sendElementToAgent = useCallback(
    async ({ element, instruction }: { element: PickedElement; instruction: string }) => {
      await sendToAgent(
        'Sending element to agent',
        (filePath) =>
          `In file \`${filePath}\`, on ${describePickedElementForAgent(element)}\n\n${instruction}\n\nPlease apply this by editing the source directly, then publish the file again.`
      );
    },
    [sendToAgent]
  );

  return { addAllToChat, sendThreadToAgent, sendSelectionToAgent, sendElementToAgent };
}
