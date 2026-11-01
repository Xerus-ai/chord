import type { NotificationView } from '@chord/protocol';
import { useQuery } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import { useMemo } from 'react';
import { requestArtifactCard } from '@renderer/features/artifacts/artifact-card-request';
import { useOpenTarget } from '@renderer/features/deep-links/use-open-target';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';
import { MY_INVITES_KEY, useInviteActions } from '@renderer/lib/hooks/use-invite-actions';
import { cn } from '@renderer/utils/utils';
import { clickForNotification } from './notification-navigation';
import { NotificationInviteRow, NotificationRow } from './notification-row';

interface NotificationDropdownProps {
  open: boolean;
  onClose: () => void;
  /** Owned by the shell so the bell's unread dot and this list can never
   *  disagree — two useNotifications instances kept separate read state. */
  notifications: NotificationView[];
  unreadCount: number;
  onMarkAsRead: (id: string) => void;
  onMarkAllAsRead: () => void;
}

export function NotificationDropdown({
  open,
  onClose,
  notifications,
  unreadCount,
  onMarkAsRead,
  onMarkAllAsRead,
}: NotificationDropdownProps) {
  const openTarget = useOpenTarget();
  const { accept, decline } = useInviteActions();

  // The authoritative set of invites still open FOR this user. A notification
  // carrying an invite_id renders inline Accept/Decline only while its invite
  // is genuinely pending — once accepted/declined/revoked (possibly elsewhere)
  // it becomes a plain read row instead of stale, misfiring buttons.
  const { data: myInvites } = useQuery({
    queryKey: [...MY_INVITES_KEY],
    queryFn: () => cloudTeamApi.getMyInvites(),
    enabled: open,
    staleTime: 30_000,
  });
  const pendingInviteIds = useMemo(() => new Set((myInvites ?? []).map((i) => i.id)), [myInvites]);

  if (!open) return null;

  const openNotification = (n: NotificationView) => {
    if (!n.read) onMarkAsRead(n.id);
    // The target view resolves the ids with server access checks; the
    // payload is never trusted for access.
    const click = clickForNotification(n);
    if (!click) return;
    if (click.commentCard) {
      requestArtifactCard(click.commentCard.artifactId, 'comments', click.commentCard.commentId);
    }
    openTarget(click.target);
    onClose();
  };

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        data-testid="notification-dropdown"
        className={cn(
          'fixed left-3 top-[52px] z-50 w-[380px] max-h-[480px]',
          'floating-surface flex flex-col rounded-lg',
          'animate-in fade-in slide-in-from-top-2'
        )}
      >
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-title tracking-title font-semibold text-text">Notifications</span>
            {unreadCount > 0 && (
              <span className="rounded-full bg-action-bg px-1.5 py-0.5 text-micro tracking-micro font-bold text-action-fg">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={onMarkAllAsRead}
              className="text-tiny tracking-tiny text-text-passive transition-colors hover:text-text"
            >
              Mark all read
            </button>
          )}
        </div>

        <div className="flex-1 overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <Bell className="mb-2 h-8 w-8 text-text-passive opacity-30" />
              <p className="text-body tracking-body text-text-passive">No notifications yet</p>
              <p className="mt-1 text-tiny tracking-tiny text-text-passive">
                You'll see it here when a teammate shares, mentions you or comments.
              </p>
            </div>
          ) : (
            <div className="flex flex-col py-1">
              {notifications.map((n) => {
                // A team_invite whose invite is still pending is accepted in the
                // row (an invite is not a navigable work item, and the buttons
                // would nest inside the row button otherwise).
                if (n.type === 'team_invite' && n.invite_id && pendingInviteIds.has(n.invite_id)) {
                  const inviteId = n.invite_id;
                  const acceptPending = accept.isPending && accept.variables === inviteId;
                  const declinePending = decline.isPending && decline.variables === inviteId;
                  return (
                    <NotificationInviteRow
                      key={n.id}
                      notification={n}
                      busy={acceptPending || declinePending}
                      acceptLabel={acceptPending ? 'Accepting…' : 'Accept'}
                      declineLabel={declinePending ? 'Declining…' : 'Decline'}
                      onAccept={() =>
                        accept.mutate(inviteId, {
                          onSuccess: () => {
                            if (!n.read) onMarkAsRead(n.id);
                            onClose();
                          },
                        })
                      }
                      onDecline={() =>
                        decline.mutate(inviteId, {
                          onSuccess: () => {
                            if (!n.read) onMarkAsRead(n.id);
                          },
                        })
                      }
                    />
                  );
                }
                return (
                  <NotificationRow key={n.id} notification={n} onOpen={() => openNotification(n)} />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
