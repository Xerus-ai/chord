import { Globe, Lock, Users } from 'lucide-react';
import { useState } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import {
  ACCESS_ROLE_LABELS,
  type GeneralAccess,
  type MemberRole,
  type SharingState,
} from './sharing-api';

type TeamAccess = Exclude<GeneralAccess, 'link'>;

function accessLabel(access: GeneralAccess, teamName: string): string {
  if (access === 'team') return `Everyone in ${teamName}`;
  return access === 'invited' ? 'Only people invited' : 'Anyone with the link';
}

const ACCESS_DESCRIPTIONS: Record<GeneralAccess, string> = {
  invited: 'Only you and the people listed above can open it',
  team: 'Everyone in your team can find and open it',
  link: 'Public and view-only; turn the link off in Publish',
};

const ACCESS_ICONS = { invited: Lock, team: Users, link: Globe } as const;
const TEAM_ACCESS: TeamAccess[] = ['invited', 'team'];

interface ShareGeneralAccessProps {
  state: SharingState;
  canManage: boolean;
  onChange: (access: GeneralAccess, role: MemberRole) => Promise<void>;
}

/**
 * "Who has access" inside the team: only the people invited, or everyone in
 * it (at a role). A public link is for people outside the team and lives in
 * the Publish tab (shared-items design D2); while one is on, this says so.
 */
export function ShareGeneralAccess({ state, canManage, onChange }: ShareGeneralAccessProps) {
  const [busy, setBusy] = useState(false);
  const access = state.general_access;
  const Icon = ACCESS_ICONS[access];

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <span className="text-tiny font-medium tracking-tiny text-text-passive">Who has access</span>
      <div className="flex items-center gap-3 py-1">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover-solid">
          <Icon className="h-4 w-4 text-text-passive" />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          {canManage && access !== 'link' ? (
            <Select
              value={access}
              disabled={busy}
              onValueChange={(value) =>
                void run(() => onChange(value as TeamAccess, state.general_role))
              }
            >
              <SelectTrigger size="sm" aria-label="Who has access" className="w-fit">
                <SelectValue>
                  {(value: GeneralAccess) => accessLabel(value, state.team.name)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {TEAM_ACCESS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {accessLabel(option, state.team.name)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <span className="text-body font-semibold tracking-body text-text">
              {accessLabel(access, state.team.name)}
            </span>
          )}
          <span className="text-tiny tracking-tiny text-text-passive">
            {ACCESS_DESCRIPTIONS[access]}
          </span>
        </div>
        {access === 'team' && canManage ? (
          <Select
            value={state.general_role}
            disabled={busy}
            onValueChange={(value) => void run(() => onChange('team', value as MemberRole))}
          >
            <SelectTrigger size="sm" aria-label="Access for the team" className="w-28 shrink-0">
              <SelectValue>{(value: MemberRole) => ACCESS_ROLE_LABELS[value]}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="view">{ACCESS_ROLE_LABELS.view}</SelectItem>
              <SelectItem value="edit">{ACCESS_ROLE_LABELS.edit}</SelectItem>
            </SelectContent>
          </Select>
        ) : access !== 'invited' ? (
          <span className="shrink-0 px-2 text-tiny font-medium tracking-tiny text-text-muted">
            {ACCESS_ROLE_LABELS[access === 'link' ? 'view' : state.general_role]}
          </span>
        ) : null}
      </div>
    </div>
  );
}
