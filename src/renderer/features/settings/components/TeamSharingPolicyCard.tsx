import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { sharingApi, type SharingPolicy } from '@renderer/features/sharing/sharing-api';
import { cloudTeamApi } from '@renderer/lib/cloud-team-api';
import { useAccountSession } from '@renderer/lib/hooks/useAccount';
import { Switch } from '@renderer/lib/ui/switch';
import { cn } from '@renderer/utils/utils';
import { SettingRow } from './SettingRow';

// The section band (SettingsPage) is the container; cards only pad.
const CARD = '';

/**
 * Workspace › Team — the team's sharing switches (P6). Only the team owner
 * changes them; everyone else sees what applies to them.
 */
export function TeamSharingPolicyCard() {
  const queryClient = useQueryClient();
  const { data: session } = useAccountSession();
  const orgId = (session?.user as { orgId?: string | null } | undefined)?.orgId ?? null;
  const [error, setError] = useState<string | null>(null);

  const orgs = useQuery({ queryKey: ['orgs'], queryFn: cloudTeamApi.getOrgs, enabled: !!orgId });
  const policyKey = ['sharing-policy', orgId] as const;
  const policy = useQuery({
    queryKey: policyKey,
    queryFn: () => sharingApi.getSharingPolicy(orgId!),
    enabled: !!orgId,
  });

  if (!orgId) {
    return (
      <div className={cn(CARD, 'py-3 text-tiny tracking-tiny text-text-passive')}>
        Join a team to manage its sharing settings.
      </div>
    );
  }

  const isOwner = orgs.data?.find((org) => org.org_id === orgId)?.role === 'owner';
  const disabled = !isOwner || !policy.data;

  async function update(patch: Partial<SharingPolicy>) {
    setError(null);
    try {
      const next = await sharingApi.updateSharingPolicy(orgId!, patch);
      queryClient.setQueryData(policyKey, next);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update sharing settings');
    }
  }

  return (
    <div className={cn(CARD, 'flex flex-col gap-4 py-3')}>
      <SettingRow
        title="Allow public links"
        description="Members can share an artifact with anyone who has the link — read-only, in a browser, no sign-in. Turning this off stops every existing public link until it is turned on again."
        control={
          <Switch
            checked={policy.data?.allow_public_links ?? false}
            disabled={disabled}
            onCheckedChange={(allow) => void update({ allow_public_links: allow })}
          />
        }
      />
      <SettingRow
        title="Allow publishing to Confluence"
        description="Authors can publish artifacts to Confluence. A published page is a copy that Confluence's own permissions govern."
        control={
          <Switch
            checked={policy.data?.allow_confluence_publishing ?? false}
            disabled={disabled}
            onCheckedChange={(allow) => void update({ allow_confluence_publishing: allow })}
          />
        }
      />
      {!isOwner && orgs.data && (
        <p className="text-tiny tracking-tiny text-text-passive">
          Only the team owner can change these.
        </p>
      )}
      {(error || policy.error) && (
        <p className="text-tiny tracking-tiny text-status-err">
          {error ?? (policy.error instanceof Error ? policy.error.message : 'Failed to load')}
        </p>
      )}
    </div>
  );
}
