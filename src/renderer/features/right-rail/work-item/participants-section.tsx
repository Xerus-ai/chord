import { RotateCw } from 'lucide-react';
import { ACCESS_ROLE_LABELS, type Participant } from '@renderer/features/sharing/sharing-api';
import type { SharingAvailability } from '@renderer/features/sharing/sharing-availability';
import { useParticipants } from '@renderer/features/work-list/use-participants';
import { ListRow, RowActions } from '@renderer/lib/components/list-row';
import { RailEmpty, RailSection } from '../rail-primitives';
import { rosterBody } from './roster-body';

function ParticipantAvatar({ participant }: { participant: Participant }) {
  if (participant.avatar_url) {
    return (
      <img src={participant.avatar_url} alt="" className="size-icon-lg shrink-0 rounded-full" />
    );
  }
  const label = participant.name ?? participant.email ?? '?';
  return (
    <span className="flex size-icon-lg shrink-0 items-center justify-center rounded-full bg-surface-hover-solid text-avatar-sm font-medium text-text-muted">
      {label.charAt(0).toUpperCase()}
    </span>
  );
}

/**
 * Who else is on this work item.
 *
 * An item that cannot be shared yet (another account's, signed out) says why
 * instead of fetching: its roster would 404, and a Retry could not help
 * (shared-items design §5, "Disabled states"). One still syncing does not
 * fetch either, but its author is known locally and listed at once — it read
 * "Syncing…" with nobody in it until the cloud create landed (devstation-ny7).
 *
 * The roster is the shared live query (`useParticipants`), so a failed
 * fetch keeps showing the last roster with a retry beside it — the old panel
 * replaced the whole list with the words "Load participants failed", which
 * threw away data it already had. Until the first fetch lands it says it is
 * loading (`rosterBody`): a teammate read "Not shared with anyone" on an item
 * shared with them (devstation-nyw).
 */
export function ParticipantsSection({
  workItemId,
  availability,
  onShare,
}: {
  workItemId: string;
  availability: SharingAvailability;
  /** The section's own header action, as every section in the map has one. */
  onShare?: () => void;
}) {
  const note = availability.kind === 'available' ? null : availability.people;
  const syncing = availability.kind === 'syncing';
  const { participants, query } = useParticipants(workItemId, {
    enabled: note === null && !syncing,
  });

  if (availability.kind === 'syncing') {
    return (
      <RailSection sectionId="work-item:participants" title="People" count={1}>
        <ParticipantRow participant={availability.author} />
      </RailSection>
    );
  }
  if (note !== null) {
    return (
      <RailSection sectionId="work-item:participants" title="People">
        <RailEmpty>{note}</RailEmpty>
      </RailSection>
    );
  }

  const body = rosterBody(query, participants.length);

  return (
    <RailSection
      sectionId="work-item:participants"
      title="People"
      // No count until the roster is in: "0" while loading read as nobody.
      count={body === 'loading' ? undefined : participants.length}
      trailing={
        onShare &&
        availability.kind === 'available' && (
          <button
            type="button"
            title="Share this work item"
            onClick={onShare}
            className="shrink-0 cursor-pointer rounded-xs border-none bg-transparent px-1 py-0.5 text-list-meta font-medium text-text-passive opacity-0 transition-[opacity,color] hover:text-text-muted group-hover:opacity-100"
          >
            Share
          </button>
        )
      }
    >
      {query.error instanceof Error && (
        <div className="flex items-center gap-2 px-3 py-1.5">
          <span className="min-w-0 flex-1 truncate text-tiny tracking-tiny text-status-err">
            {participants.length > 0 ? 'This roster may be out of date' : query.error.message}
          </span>
          <button
            type="button"
            onClick={() => void query.refetch()}
            disabled={query.isFetching}
            className="flex shrink-0 cursor-pointer items-center gap-1 rounded-xs border border-border bg-transparent px-1.5 py-0.5 text-tiny tracking-tiny font-medium text-text-muted hover:bg-surface-inset disabled:cursor-default"
          >
            <RotateCw className={`size-icon-xs ${query.isFetching ? 'animate-spin' : ''}`} />
            Retry
          </button>
        </div>
      )}

      {body === 'loading' && <RailEmpty>Loading people</RailEmpty>}
      {body === 'empty' && <RailEmpty>Not shared with anyone</RailEmpty>}
      {body === 'rows' &&
        participants.map((participant) => (
          <ParticipantRow key={participant.user_id} participant={participant} />
        ))}
    </RailSection>
  );
}

function ParticipantRow({ participant }: { participant: Participant }) {
  return (
    <div
      data-testid="participant-row"
      data-user-id={participant.user_id}
      data-role={participant.role}
    >
      <ListRow
        leading={<ParticipantAvatar participant={participant} />}
        title={participant.name ?? participant.email}
        trailing={
          <RowActions>
            <span className="text-tiny tracking-tiny text-text-passive">
              {ACCESS_ROLE_LABELS[participant.role]}
            </span>
          </RowActions>
        }
      />
    </div>
  );
}
