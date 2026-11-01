import type { ReactNode } from 'react';
import { participantColor, participantInitials } from './avatar-identity';

/** The identity fields both surfaces already hold (cloud `Participant`). */
export interface AvatarStackMember {
  user_id: string;
  name: string | null;
  email: string;
}

/** Live "viewing <file>" presence, joined to a member by user_id. */
export interface AvatarStackViewer {
  user_id: string;
  file: string;
}

const NO_VIEWERS: AvatarStackViewer[] = [];
const NO_RINGS: ReadonlySet<string> = new Set();

/**
 * Overlapping participant avatars with live viewing tooltips — the topbar's
 * presence cluster. Shared so the participant view and the owner view render
 * one stack, not two that drift: the overlap offset, ring, and overflow pill
 * are the identity of this chrome.
 */
export function AvatarStack({
  members,
  viewers = NO_VIEWERS,
  ringedIds = NO_RINGS,
  max = 3,
  fallback,
  onClick,
}: {
  members: AvatarStackMember[];
  viewers?: AvatarStackViewer[];
  /** People looking at it right now: ringed. */
  ringedIds?: ReadonlySet<string>;
  max?: number;
  /** Rendered in place of the stack when there are no members. */
  fallback?: ReactNode;
  /** The stack as a button (the header's opens the Share dialog). */
  onClick?: () => void;
}) {
  if (members.length === 0) {
    return <div className="flex">{fallback}</div>;
  }

  const shown = members.slice(0, max);
  const overflow = members.length - shown.length;

  const stack = (
    <div className="flex">
      {shown.map((member, i) => {
        const colors = participantColor(member.user_id);
        const initials = participantInitials(member.name, member.email);
        const viewing = viewers.find((v) => v.user_id === member.user_id);
        const label = member.name ?? member.email;
        return (
          <div
            key={member.user_id}
            title={viewing ? `${label} — viewing ${viewing.file}` : label}
            data-viewing={ringedIds.has(member.user_id) ? 'true' : undefined}
            className={`flex h-[22px] w-[22px] items-center justify-center rounded-full text-avatar-lg font-semibold ${
              i > 0 ? '-ml-[5px] border-2 border-surface-raised' : ''
            } ${ringedIds.has(member.user_id) ? 'ring-2 ring-status-running' : ''}`}
            style={{ background: colors.bg, color: colors.fg }}
          >
            {initials}
          </div>
        );
      })}
      {overflow > 0 && (
        <div className="-ml-[5px] flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-surface-raised bg-surface-hover-solid text-avatar-lg font-semibold text-text-muted">
          +{overflow}
        </div>
      )}
    </div>
  );
  if (!onClick) return stack;
  const count = members.length;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`Shared with ${count} ${count === 1 ? 'person' : 'people'}`}
      data-testid="header-avatar-stack"
      className="flex cursor-pointer rounded-full border-none bg-transparent p-0.5 hover:bg-surface-hover-solid"
    >
      {stack}
    </button>
  );
}
