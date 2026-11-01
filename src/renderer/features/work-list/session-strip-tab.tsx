import { MessageSquare, Terminal } from 'lucide-react';
import type { ReactNode } from 'react';
import AgentLogo from '@renderer/lib/components/agent-logo';
import { ChromeTab } from '@renderer/lib/components/chrome/chrome-tabs';
import { ContextMenuItem } from '@renderer/lib/ui/context-menu';
import { agentConfig } from '@renderer/utils/agentConfig';
import { useSessionTabDescriptor } from './session-tab-descriptor';
import {
  cloudSessionWorktrees,
  describeSessionHistory,
  describeSessionTab,
  type SessionTabDescriptor,
  type SessionTabModel,
} from './session-tab-model';
import { useWorkItemSource } from './work-item-source';

interface SessionStripTabProps {
  session: SessionTabModel;
  /**
   * The label as the strip shows it: started where it differs from its
   * neighbours' (devstation-6w3p). The tooltip keeps the full label.
   */
  shownLabel: string;
  active: boolean;
  onActivate: () => void;
  onClose: () => void;
  /** Extra context menu items, e.g. split and open-to-side in a centre pane. */
  extraMenu?: ReactNode;
}

/** One session in the centre strip: provider logo, title, branch, live status dot. */
function SessionStripTabView({
  descriptor,
  shownLabel,
  closeLabel,
  historyNote,
  active,
  onActivate,
  onClose,
  extraMenu,
}: Omit<SessionStripTabProps, 'session'> & {
  descriptor: SessionTabDescriptor;
  closeLabel: string;
  /** A line saying why this session has no history actions; shown disabled. */
  historyNote?: string | null;
}) {
  const agent = descriptor.providerId ? agentConfig[descriptor.providerId] : null;
  const icon = agent ? (
    <AgentLogo
      logo={agent.logo}
      alt={agent.alt}
      isSvg={agent.isSvg}
      invertInDark={agent.invertInDark}
      className="size-icon-sm"
    />
  ) : (
    <Terminal className="size-icon-sm" />
  );
  const title = descriptor.branch ? `${descriptor.label} · ${descriptor.branch}` : descriptor.label;

  return (
    <ChromeTab
      icon={icon}
      label={shownLabel}
      ariaLabel={shownLabel === descriptor.label ? undefined : descriptor.label}
      tag={descriptor.lane}
      title={title}
      active={active}
      showStatusDot={
        descriptor.statusBucket === 'working' || descriptor.statusBucket === 'needs_input'
      }
      statusDotTone={descriptor.statusBucket === 'needs_input' ? 'attention' : 'live'}
      onClick={onActivate}
      onClose={onClose}
      closeLabel={`${closeLabel} ${descriptor.label}`}
      contextMenu={
        <>
          <ContextMenuItem onClick={onClose}>{closeLabel}</ContextMenuItem>
          {extraMenu}
          {historyNote && <ContextMenuItem disabled>{historyNote}</ContextMenuItem>}
        </>
      }
    />
  );
}

/**
 * The owner's session: live status from this machine; closing it ends the
 * session, unless it has already ended (a chat reopened to read, step 5).
 */
function LocalSessionStripTab({ session, ...props }: SessionStripTabProps) {
  const descriptor = useSessionTabDescriptor(session);
  return (
    <SessionStripTabView
      {...props}
      descriptor={descriptor}
      historyNote={describeSessionHistory(session)}
      closeLabel={
        descriptor.kind === 'terminal'
          ? 'Close terminal'
          : session.status === 'done'
            ? 'Close tab'
            : 'End session'
      }
    />
  );
}

/**
 * A teammate's view of one of the owner's chats: its branch from the owner's
 * published worktrees. Closing it closes the tab; the owner's session goes on.
 */
function CloudSessionStripTab({
  session,
  worktrees,
  ...props
}: SessionStripTabProps & { worktrees: Parameters<typeof cloudSessionWorktrees>[0] }) {
  const descriptor = describeSessionTab(session, cloudSessionWorktrees(worktrees), {
    isStreaming: false,
    hasPendingInput: false,
  });
  return <SessionStripTabView {...props} descriptor={descriptor} closeLabel="Close tab" />;
}

export function SessionStripTab(props: SessionStripTabProps) {
  const source = useWorkItemSource();
  switch (source.kind) {
    case 'local':
      return <LocalSessionStripTab {...props} />;
    case 'cloud':
      return <CloudSessionStripTab {...props} worktrees={source.item.worktrees ?? []} />;
    case 'scoped':
      throw new Error('An artifacts-only view has no session tabs');
  }
}

/**
 * A teammate's Work item chat tab (decision 5): the item's whole chat while
 * the owner has published no chat. It has no close: it goes by itself once a
 * chat is published, and until then it is the only way into the chat.
 */
export function ItemChatStripTab({
  active,
  onActivate,
  extraMenu,
}: {
  active: boolean;
  onActivate: () => void;
  extraMenu?: ReactNode;
}) {
  return (
    <ChromeTab
      icon={<MessageSquare className="size-icon-sm" />}
      label="Work item"
      title="The work item's chat"
      active={active}
      onClick={onActivate}
      contextMenu={extraMenu}
    />
  );
}
