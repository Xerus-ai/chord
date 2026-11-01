import { MessageSquare } from 'lucide-react';
import { ENDED_SESSION_WORD } from '@renderer/features/right-rail/work-item/session-row-presentation';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { DropdownMenuItem, DropdownMenuSeparator } from '@renderer/lib/ui/dropdown-menu';
import { agentConfig } from '@renderer/utils/agentConfig';
import { describeSessionTab, type SessionTabModel } from './session-tab-model';

const IDLE = { isStreaming: false, hasPendingInput: false };

/**
 * The owner's ended chats in `+` (shared-items step 5, decision 5), each
 * reopened as a tab to read; its composer says it has ended. Marked as the
 * teammate's `+` marks them.
 */
export function EndedChatsMenuSection({
  chats,
  onOpen,
}: {
  chats: readonly SessionTabModel[];
  onOpen: (sessionId: string) => void;
}) {
  if (chats.length === 0) return null;
  return (
    <>
      <DropdownMenuSeparator />
      {chats.map((session) => {
        const descriptor = describeSessionTab(session, undefined, IDLE);
        const agent = descriptor.providerId ? agentConfig[descriptor.providerId] : null;
        return (
          <DropdownMenuItem key={session.id} onClick={() => onOpen(session.id)}>
            {agent ? (
              <AgentLogo
                logo={agent.logo}
                alt={agent.alt}
                isSvg={agent.isSvg}
                invertInDark={agent.invertInDark}
                className="h-3.5 w-3.5"
              />
            ) : (
              <MessageSquare className="h-3.5 w-3.5" />
            )}
            {descriptor.label}
            <span className="ml-auto pl-3 text-tiny tracking-tiny text-text-passive capitalize">
              {ENDED_SESSION_WORD}
            </span>
          </DropdownMenuItem>
        );
      })}
    </>
  );
}
