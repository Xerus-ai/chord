import { describeTypingLine } from './typing-line';
import { useParticipants } from './use-participants';
import { useTypingIndicators } from './use-typing-indicators';

/**
 * Who else is typing in the work item, above the composer: owner and teammate
 * both send typing (the composer's draft changes) and both read it here,
 * named as the People list names them.
 */
export function TypingIndicatorBar({ workItemId }: { workItemId: string }) {
  const typingUsers = useTypingIndicators(workItemId);
  const { participants } = useParticipants(workItemId);
  const text = describeTypingLine(typingUsers, participants);
  if (text === null) return null;

  return (
    <div className="px-5 py-1 text-tiny tracking-tiny text-text-passive">
      <span className="animate-pulse">{text}</span>
    </div>
  );
}
