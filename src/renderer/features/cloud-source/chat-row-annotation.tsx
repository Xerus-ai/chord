import type { ReactNode } from 'react';
import type { ChatMessageEntry } from '@renderer/features/work-list/chat-types';

export type RowAlign = 'self' | 'peer';

/**
 * Which side of the transcript a row is drawn on — the same test MessageRow
 * itself applies (rows without a sender_id are legacy local writes, which only
 * this device's owner could have produced).
 */
export function rowAlignOf(entry: ChatMessageEntry, currentUserId: string | null): RowAlign {
  if (entry.sender !== 'human') return 'peer';
  return entry.senderId === null || entry.senderId === currentUserId ? 'self' : 'peer';
}

/**
 * Metadata pinned to a message row (delivery chip, undelivered notice). It
 * tracks the row's own side and content indent instead of the container's
 * trailing edge — a peer's prompt sits on the left, so a chip hard-aligned
 * right floated at the far edge of the transcript with nothing above it.
 * Must be rendered inside the row's flex-column wrapper.
 */
export function ChatRowAnnotation({ align, children }: { align: RowAlign; children: ReactNode }) {
  return (
    <div className={`mt-0.5 flex ${align === 'self' ? 'self-end pr-1' : 'self-start pl-[30px]'}`}>
      {children}
    </div>
  );
}
