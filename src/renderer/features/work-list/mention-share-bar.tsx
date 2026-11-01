import { Loader2 } from 'lucide-react';
import type { MemberRole } from '@renderer/features/sharing/sharing-api';
import { Button } from '@renderer/lib/ui/button';
import type { MentionPerson } from './mention-access';

function names(people: MentionPerson[]): string {
  const labels = people.map((person) => person.name ?? person.email);
  if (labels.length === 1) return labels[0]!;
  return `${labels.slice(0, -1).join(', ')} and ${labels[labels.length - 1]}`;
}

/**
 * Above Send, when a message mentions someone who cannot see the work item
 * (shared-items design §5): "Priya can't see this work item. Share · Can view
 * · Can edit · Don't share". The message goes out after the choice.
 */
export function MentionShareBar({
  people,
  busy,
  error,
  onChoose,
  onCancel,
}: {
  people: MentionPerson[];
  busy: boolean;
  error: string | null;
  onChoose: (choice: MemberRole | 'dont') => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="flex flex-col gap-2 border-t border-border-subtle bg-surface-raised px-5 py-3"
      data-testid="mention-share-bar"
    >
      <p className="text-body tracking-body text-text">
        <span className="font-semibold">{names(people)}</span> can&apos;t see this work item. Share
        it with {people.length > 1 ? 'them' : 'this person'}?
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {busy && <Loader2 className="h-4 w-4 animate-spin text-text-passive" />}
        <Button size="sm" disabled={busy} onClick={() => onChoose('view')}>
          Share · Can view
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => onChoose('edit')}>
          Can edit
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => onChoose('dont')}>
          Don&apos;t share
        </Button>
        <span className="flex-1" />
        <Button size="sm" variant="ghost" disabled={busy} onClick={onCancel}>
          Cancel message
        </Button>
      </div>
      {error && <p className="text-tiny tracking-tiny text-status-err">{error}</p>}
    </div>
  );
}
