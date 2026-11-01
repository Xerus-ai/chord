import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FileText, Globe, Link2, Lock, Users } from 'lucide-react';
import { useState } from 'react';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import {
  sharingApi,
  type GeneralAccess,
  type SharedByMeRow,
} from '@renderer/features/sharing/sharing-api';
import { LoadErrorNotice } from '@renderer/lib/components/load-error-notice';
import { Button } from '@renderer/lib/ui/button';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import { cn } from '@renderer/utils/utils';
import { ResetToDefaultButton } from './ResetToDefaultButton';

// The section band (SettingsPage) is the container; cards only pad.
const CARD = '';
const SHARED_BY_ME_KEY = ['sharing', 'shared-by-me'] as const;

/** You › Sharing — who can open a NEW work item (P6). Existing items keep their access. */
export function DefaultAccessSettingsCard() {
  const { value, isLoading, isFieldOverridden, resetField, update } = useAppSettingsKey('sharing');
  const selected = value?.defaultWorkItemAccess ?? 'invited';

  const options = [
    {
      value: 'invited' as const,
      label: 'Only you',
      description: 'Nobody sees a new work item until you share it.',
    },
    {
      value: 'team_view' as const,
      label: 'Anyone in my team can view',
      description: 'Teammates can open new work items and read along. Only you can edit.',
    },
  ];

  return (
    <div className={cn(CARD, 'flex flex-col gap-3 py-3')}>
      <div className="flex items-start justify-between gap-3">
        <span className="text-tiny tracking-tiny text-text-passive">
          Who can open a work item when you create it
        </span>
        <ResetToDefaultButton
          visible={isFieldOverridden('defaultWorkItemAccess')}
          defaultLabel="Only you"
          onReset={() => resetField('defaultWorkItemAccess')}
          disabled={isLoading}
        />
      </div>
      <RadioGroup
        value={selected}
        onValueChange={(next) => update({ defaultWorkItemAccess: next as 'invited' | 'team_view' })}
        disabled={isLoading || !value}
        className="gap-0"
      >
        {options.map((option) => (
          <label
            key={option.value}
            className={cn(
              'flex cursor-pointer items-start gap-3 border px-3.5 py-2.5 transition-colors first:rounded-t-lg last:rounded-b-lg',
              selected === option.value
                ? 'border-selected-border bg-selected-bg'
                : 'border-border-subtle hover:bg-surface-hover'
            )}
          >
            <RadioGroupItem value={option.value} className="mt-0.5" />
            <span className="flex flex-col gap-0.5">
              <span className="text-body tracking-body text-text">{option.label}</span>
              <span className="text-tiny tracking-tiny text-text-muted">{option.description}</span>
            </span>
          </label>
        ))}
      </RadioGroup>
    </div>
  );
}

const ACCESS_ICONS: Record<GeneralAccess, typeof Lock> = {
  invited: Lock,
  team: Users,
  link: Globe,
};

function describeAccess(row: SharedByMeRow): string {
  const people =
    row.member_count > 0
      ? `${row.member_count} ${row.member_count === 1 ? 'person' : 'people'}`
      : '';
  const general =
    row.general_access === 'team'
      ? `your team (${row.general_role === 'edit' ? 'can edit' : 'can view'})`
      : row.general_access === 'link'
        ? 'anyone with the link'
        : '';
  return [people, general].filter(Boolean).join(' and ') || 'Only you';
}

/** You › Sharing — everything you have shared, with Copy link and Stop sharing per row. */
export function SharedByMeCard() {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: SHARED_BY_ME_KEY, queryFn: sharingApi.getSharedByMe });
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function stopSharing(row: SharedByMeRow, key: string) {
    setBusyKey(key);
    setError(null);
    try {
      await sharingApi.stopSharing({
        workItemId: row.work_item_id,
        artifactId: row.artifact_id ?? undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['sharing'] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to stop sharing');
    } finally {
      setBusyKey(null);
    }
  }

  async function copyLink(url: string, key: string) {
    await navigator.clipboard.writeText(url);
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 2000);
  }

  if (query.error) {
    return (
      <LoadErrorNotice
        title="Couldn't load what you've shared"
        message={query.error instanceof Error ? query.error.message : String(query.error)}
        onRetry={() => void query.refetch()}
      />
    );
  }

  const rows = query.data ?? [];
  return (
    <div className={cn(CARD, 'flex flex-col divide-y divide-border-subtle')}>
      {query.isLoading ? (
        <p className="p-4 text-tiny tracking-tiny text-text-passive">Loading…</p>
      ) : rows.length === 0 ? (
        <p className="p-4 text-tiny tracking-tiny text-text-passive">
          You haven&apos;t shared anything yet. Everything you create stays private until you share
          it.
        </p>
      ) : (
        rows.map((row) => {
          const key = `${row.work_item_id}:${row.artifact_id ?? ''}`;
          const Icon = ACCESS_ICONS[row.general_access];
          return (
            <div key={key} className="flex items-center gap-3 px-4 py-3">
              {row.kind === 'artifact' ? (
                <FileText className="h-4 w-4 shrink-0 text-text-passive" />
              ) : (
                <Icon className="h-4 w-4 shrink-0 text-text-passive" />
              )}
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-body tracking-body text-text">{row.name}</span>
                <span className="truncate text-tiny tracking-tiny text-text-muted">
                  {row.kind === 'artifact' ? 'Artifact' : 'Work item'} · shared with{' '}
                  {describeAccess(row)}
                </span>
              </div>
              {row.link_url && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => void copyLink(row.link_url!, key)}
                >
                  <Link2 />
                  {copiedKey === key ? 'Copied' : 'Copy link'}
                </Button>
              )}
              <Button
                size="xs"
                variant="ghost"
                disabled={busyKey === key}
                onClick={() => void stopSharing(row, key)}
              >
                Stop sharing
              </Button>
            </div>
          );
        })
      )}
      {error && <p className="p-4 text-tiny tracking-tiny text-status-err">{error}</p>}
    </div>
  );
}
