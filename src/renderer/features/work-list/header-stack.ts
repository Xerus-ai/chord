import type {
  AvatarStackMember,
  AvatarStackViewer,
} from '@renderer/lib/components/chrome/avatar-stack';

/**
 * The header's avatar stack (shared-items design §5), the one visible sign
 * that an item is shared: the people you share it with, the ones looking at
 * it right now first and ringed; never yourself.
 */
export function stackMembers(
  participants: AvatarStackMember[],
  viewers: AvatarStackViewer[],
  selfId: string | null
): { members: AvatarStackMember[]; ringedIds: Set<string> } {
  const others = participants.filter((person) => person.user_id !== selfId);
  const ringedIds = new Set(
    viewers
      .map((viewer) => viewer.user_id)
      .filter((id) => id !== selfId && others.some((person) => person.user_id === id))
  );
  const members = [
    ...others.filter((person) => ringedIds.has(person.user_id)),
    ...others.filter((person) => !ringedIds.has(person.user_id)),
  ];
  return { members, ringedIds };
}
