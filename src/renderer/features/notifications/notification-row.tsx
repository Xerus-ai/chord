import type { NotificationView } from '@chord/protocol';
import type { ReactNode } from 'react';
import { MemberAvatar } from '@renderer/features/dashboard/member-avatar';
import { Button } from '@renderer/lib/ui/button';
import { cn } from '@renderer/utils/utils';
import { describeNotification, type NotificationDescription } from './describe-notification';

/**
 * One notification in the bell (shared-items design §4): unread dot, the
 * actor's avatar, line 1 with the names in bold, line 2, and how long ago.
 */
export function NotificationRow({
  notification,
  onOpen,
}: {
  notification: NotificationView;
  onOpen: () => void;
}) {
  const description = describeNotification(notification);
  return (
    <button
      type="button"
      data-testid="notification-row"
      onClick={onOpen}
      className={cn(rowClass(notification.read), 'w-full text-left hover:bg-surface-raised')}
    >
      <RowBody notification={notification} description={description} />
    </button>
  );
}

/** A team invite still open: accepted or declined in the row itself. */
export function NotificationInviteRow({
  notification,
  busy,
  acceptLabel,
  declineLabel,
  onAccept,
  onDecline,
}: {
  notification: NotificationView;
  busy: boolean;
  acceptLabel: string;
  declineLabel: string;
  onAccept: () => void;
  onDecline: () => void;
}) {
  const description = describeNotification(notification);
  return (
    <div data-testid="notification-row" className={rowClass(notification.read)}>
      <RowBody notification={notification} description={description}>
        <div className="mt-2 flex gap-2">
          <Button
            type="button"
            className="h-7 px-2 text-tiny tracking-tiny"
            disabled={busy}
            onClick={onAccept}
          >
            {acceptLabel}
          </Button>
          <Button
            type="button"
            variant="secondary"
            className="h-7 px-2 text-tiny tracking-tiny"
            disabled={busy}
            onClick={onDecline}
          >
            {declineLabel}
          </Button>
        </div>
      </RowBody>
    </div>
  );
}

function rowClass(read: boolean): string {
  return cn('flex items-start gap-2.5 px-3 py-2 transition-colors', read && 'opacity-60');
}

function RowBody({
  notification,
  description,
  children,
}: {
  notification: NotificationView;
  description: NotificationDescription;
  children?: ReactNode;
}) {
  return (
    <>
      <span className="mt-2.5 shrink-0">
        <UnreadDot read={notification.read} />
      </span>
      <span className="mt-0.5 shrink-0">
        <MemberAvatar name={description.actor.name} avatarUrl={description.actor.avatarUrl} />
      </span>
      <span className="block min-w-0 flex-1">
        <span className="block text-list-row text-text">
          <NotificationLine1 description={description} />
        </span>
        {description.line2 && (
          <span className="mt-0.5 block text-list-meta leading-relaxed text-text-passive line-clamp-2">
            {description.line2}
          </span>
        )}
        {children}
      </span>
      <span className="shrink-0 text-list-meta text-text-passive">
        {relativeTime(notification.created_at)}
      </span>
    </>
  );
}

/** Line 1 of a notification: names bold, the verb between them plain. */
function NotificationLine1({ description }: { description: NotificationDescription }) {
  return (
    <span>
      {description.line1.map((segment, index) =>
        segment.bold ? (
          <span key={index} className="font-semibold">
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        )
      )}
    </span>
  );
}

/** The row's unread marker. A read row keeps the same box so rows stay aligned. */
function UnreadDot({ read }: { read: boolean }) {
  return read ? (
    <span className="block h-1.5 w-1.5" />
  ) : (
    <span
      data-testid="notification-unread"
      className="block h-1.5 w-1.5 rounded-full bg-status-running"
    />
  );
}

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  if (diffMs < 0) return 'now';
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return `${Math.floor(days / 7)}w`;
}
