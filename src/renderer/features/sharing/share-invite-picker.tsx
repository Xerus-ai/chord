import { Loader2 } from 'lucide-react';
import { useState } from 'react';
import { MemberAvatar } from '@renderer/features/dashboard/member-avatar';
import type { OrgMember } from '@renderer/lib/cloud-team-api';
import { Button } from '@renderer/lib/ui/button';
import { Input } from '@renderer/lib/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { inviteCandidates, type InviteCandidate } from './invite-candidates';
import { ACCESS_ROLE_LABELS, type MemberRole } from './sharing-api';

interface ShareInvitePickerProps {
  teamName: string;
  roster: OrgMember[];
  authorId: string;
  /** People who already have access: not offered again. */
  memberUserIds: string[];
  /** Resolves when shared; rejects with the server's error otherwise. */
  onInvite: (email: string, role: MemberRole, addToTeam: boolean) => Promise<void>;
}

/**
 * Invite from the team (shared-items step 3, decision 3): type to narrow the
 * roster, pick someone, and they are added with the chosen role. An email
 * outside the team asks first, since adding them takes a seat.
 */
export function ShareInvitePicker({
  teamName,
  roster,
  authorId,
  memberUserIds,
  onInvite,
}: ShareInvitePickerProps) {
  const [query, setQuery] = useState('');
  const [role, setRole] = useState<MemberRole>('view');
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const candidates = inviteCandidates({ roster, authorId, memberUserIds, query });

  async function invite(candidate: InviteCandidate) {
    setBusy(true);
    setError(null);
    try {
      await onInvite(candidate.email, role, candidate.kind === 'outside');
      setQuery('');
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to share');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex flex-col gap-2" data-testid="share-invite-picker">
      <div className="flex items-center gap-2">
        <Input
          placeholder={`Add people from ${teamName}, or an email`}
          value={query}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setError(null);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setOpen(false);
            if (e.key === 'Enter' && candidates.length === 1) void invite(candidates[0]!);
          }}
          className="flex-1"
        />
        <Select value={role} onValueChange={(value) => setRole(value as MemberRole)}>
          <SelectTrigger aria-label="Access for the people you invite" className="w-28 shrink-0">
            <SelectValue>{(value: MemberRole) => ACCESS_ROLE_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="view">{ACCESS_ROLE_LABELS.view}</SelectItem>
            <SelectItem value="edit">{ACCESS_ROLE_LABELS.edit}</SelectItem>
          </SelectContent>
        </Select>
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-text-passive" />}
      </div>

      {open && candidates.length > 0 && (
        <div
          role="listbox"
          aria-label="People to invite"
          className="flex max-h-48 flex-col overflow-y-auto rounded-md border border-border bg-surface-raised p-1"
        >
          {candidates.map((candidate) => (
            <button
              key={candidate.kind === 'teammate' ? candidate.user_id : `outside:${candidate.email}`}
              type="button"
              role="option"
              aria-selected={false}
              disabled={busy}
              onClick={() => void invite(candidate)}
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-left hover:bg-surface-inset disabled:cursor-default"
            >
              {candidate.kind === 'teammate' ? (
                <>
                  <MemberAvatar
                    name={candidate.name ?? candidate.email}
                    avatarUrl={candidate.avatar_url}
                  />
                  <span className="min-w-0 flex-1 truncate text-body tracking-body text-text">
                    {candidate.name ?? candidate.email}
                  </span>
                  {candidate.name && (
                    <span className="truncate text-tiny tracking-tiny text-text-passive">
                      {candidate.email}
                    </span>
                  )}
                </>
              ) : (
                <span className="text-body tracking-body text-text">
                  Add <span className="font-semibold">{candidate.email}</span> to {teamName} and
                  share (uses one seat)
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {error && <p className="text-tiny tracking-tiny text-status-err">{error}</p>}
      {open && query !== '' && candidates.length === 0 && (
        <p className="text-tiny tracking-tiny text-text-passive">
          Nobody in {teamName} matches. Type a whole email to add someone to the team.
        </p>
      )}
      {open && (
        <Button
          variant="ghost"
          size="xs"
          className="self-end"
          onClick={() => {
            setOpen(false);
            setQuery('');
          }}
        >
          Done
        </Button>
      )}
    </div>
  );
}
