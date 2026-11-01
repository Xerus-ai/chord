import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { sharingApi, type MemberRole } from '@renderer/features/sharing/sharing-api';
import { rpc } from '@renderer/lib/ipc';
import type { ResolvedRoute } from './chat-routing';
import { mentionAccess, planMentionShare, type MentionPerson } from './mention-access';

interface PendingSend {
  content: string;
  route: ResolvedRoute;
  people: MentionPerson[];
}

/**
 * Share by @mention, the owner's (shared-items design §5): the whole team can
 * be mentioned (`useMentionRoster`); a message that mentions someone who
 * cannot see the work item waits for the owner to share it with them (or
 * not), then goes out. A null roster asks nothing.
 */
export function useMentionShare({
  workItemId,
  roster,
  send,
}: {
  workItemId: string;
  roster: MentionPerson[] | null;
  send: (content: string, route: ResolvedRoute) => void;
}) {
  const queryClient = useQueryClient();

  const [pending, setPending] = useState<PendingSend | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSend = useCallback(
    (content: string, route: ResolvedRoute) => {
      const people = roster ? mentionAccess(route.mentionedUserIds, roster) : [];
      if (people.length === 0) {
        send(content, route);
        return;
      }
      setError(null);
      setPending({ content, route, people });
    },
    [roster, send]
  );

  const choose = useCallback(
    async (choice: MemberRole | 'dont') => {
      if (!pending) return;
      setBusy(true);
      setError(null);
      try {
        for (const share of planMentionShare(choice, pending.people)) {
          await sharingApi.addMember({ workItemId }, share.email, share.role, false);
        }
        if (choice !== 'dont') {
          await queryClient.invalidateQueries({ queryKey: ['sharing', workItemId] });
          await queryClient.invalidateQueries({ queryKey: ['participants', workItemId] });
          // As the Share dialog does (use-sharing.ts): the item is shared now,
          // so its git state and chat registry go up without the 60 s lag.
          await rpc.syncQueue.kickGitStateCapture();
        }
        send(pending.content, pending.route);
        setPending(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Sharing failed');
      } finally {
        setBusy(false);
      }
    },
    [pending, queryClient, send, workItemId]
  );

  return { handleSend, pending, choose, busy, error, cancel: () => setPending(null) };
}
