import type { CloudSession, CloudWorktree } from '@chord/protocol';
import { MessageSquare, Plus } from 'lucide-react';
import { ENDED_SESSION_WORD } from '@renderer/features/right-rail/work-item/session-row-presentation';
import AgentLogo from '@renderer/lib/components/agent-logo';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@renderer/lib/ui/dropdown-menu';
import { agentConfig } from '@renderer/utils/agentConfig';
import { openCenterTab, useCenterLayout } from './center-tabs-store';
import { listCloudChatEntries } from './cloud-chat-launcher';
import { cloudSessionWorktrees, describeSessionTab } from './session-tab-model';

const IDLE = { isStreaming: false, hasPendingInput: false };

/**
 * A teammate's `+`: the owner's chats, to open one or bring its tab forward.
 * A teammate cannot start a chat, so this is how a closed chat, ended ones
 * included, comes back.
 */
export function CloudChatLauncherMenu({
  layoutKey,
  sessions,
  worktrees,
}: {
  layoutKey: string;
  sessions: readonly CloudSession[];
  worktrees: readonly CloudWorktree[];
}) {
  const { layout } = useCenterLayout(layoutKey);
  const entries = listCloudChatEntries(sessions, layout);
  const branches = cloudSessionWorktrees(worktrees);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Open a chat"
        title="Open a chat"
        className="ml-0.5 flex size-[26px] shrink-0 cursor-pointer items-center justify-center self-center rounded-md border-none bg-transparent text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
      >
        <Plus className="size-icon-md" strokeWidth={1.75} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-max min-w-56 whitespace-nowrap">
        {entries.length === 0 ? (
          <div className="px-2 py-1.5 text-tiny tracking-tiny text-text-muted">
            The owner has not started a chat yet
          </div>
        ) : (
          entries.map(({ session, open, ended }) => {
            const descriptor = describeSessionTab(session, branches, IDLE);
            const agent = descriptor.providerId ? agentConfig[descriptor.providerId] : null;
            return (
              <DropdownMenuItem
                key={session.id}
                onClick={() => openCenterTab(layoutKey, { kind: 'session', sessionId: session.id })}
              >
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
                {descriptor.branch && (
                  <span className="text-text-passive">· {descriptor.branch}</span>
                )}
                {(ended || open) && (
                  <span className="ml-auto pl-3 text-tiny tracking-tiny text-text-passive capitalize">
                    {ended ? ENDED_SESSION_WORD : 'open'}
                  </span>
                )}
              </DropdownMenuItem>
            );
          })
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
