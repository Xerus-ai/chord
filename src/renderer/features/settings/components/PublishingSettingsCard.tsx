import { ExternalLink } from 'lucide-react';
import type { ConfluenceUpdateMode } from '@shared/confluence';
import {
  useConfluenceConnection,
  useConfluenceSpaces,
} from '@renderer/features/confluence/use-confluence';
import { useAppSettingsKey } from '@renderer/features/settings/use-app-settings-key';
import { useNavigate } from '@renderer/lib/layout/navigation-provider';
import { RadioGroup, RadioGroupItem } from '@renderer/lib/ui/radio-group';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { cn } from '@renderer/utils/utils';
import { SettingRow } from './SettingRow';

// The section band (SettingsPage) is the container; cards only pad.
const CARD = '';
const ACTION =
  'inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2.5 text-tiny tracking-tiny font-semibold transition-colors';

const UPDATE_MODES: Array<{ value: ConfluenceUpdateMode; label: string }> = [
  { value: 'ask', label: 'Ask before updating the Confluence page' },
  { value: 'auto', label: 'Update the Confluence page automatically' },
];

/**
 * Settings › Agents › Artifacts — "Publishing" (plan 2026-09-23 §3, P5). The
 * Confluence connection itself lives in Connections › Integrations, per device
 * (P5 decision 2026-09-24); this card reflects it and holds the two choices
 * that shape a publish. Not connected, it collapses to one row with Connect.
 */
export function PublishingSettingsCard() {
  const { navigate } = useNavigate();
  const connection = useConfluenceConnection();
  const status = connection.status;
  const connected = status?.connected === true;
  const spaces = useConfluenceSpaces(connected);
  const settings = useAppSettingsKey('artifacts');
  const openIntegrations = () =>
    navigate('settings', { tab: 'integrations', card: 'integrations' });

  if (!connected) {
    return (
      <div className={cn(CARD, 'py-3')}>
        <SettingRow
          title="Publish artifacts to Confluence"
          description={
            status && !status.connected && status.error
              ? `The saved connection no longer works: ${status.error}`
              : undefined
          }
          control={
            <button
              type="button"
              disabled={connection.isLoading}
              onClick={openIntegrations}
              className={cn(
                ACTION,
                'border-none bg-action-bg text-action-fg hover:bg-action-bg-hover'
              )}
            >
              Connect
            </button>
          }
        />
      </div>
    );
  }

  const spaceKey = settings.value?.confluenceDefaultSpaceKey ?? null;
  const spaceItems = (spaces.data ?? []).map((space) => ({ value: space.key, label: space.name }));

  return (
    <div className={cn(CARD, 'flex flex-col divide-y divide-border-subtle')}>
      <div className="p-4">
        <SettingRow
          title="Confluence"
          description={`Connected · ${new URL(status.siteUrl).host}`}
          control={
            <button
              type="button"
              onClick={openIntegrations}
              className={cn(
                ACTION,
                'border border-border bg-transparent text-text-muted hover:border-border-strong hover:text-text'
              )}
            >
              Manage
              <ExternalLink className="h-3 w-3" />
            </button>
          }
        />
      </div>
      <div className="p-4">
        <SettingRow
          title="Default space"
          description={
            spaces.error ? (
              <span className="text-status-err">{spaces.error.message}</span>
            ) : (
              'New artifacts are published to this space.'
            )
          }
          control={
            <Select
              value={spaceKey ?? ''}
              items={spaceItems}
              disabled={spaces.isLoading || settings.isLoading || spaceItems.length === 0}
              onValueChange={(next) =>
                settings.update({ confluenceDefaultSpaceKey: (next as string) || null })
              }
            >
              <SelectTrigger
                aria-label="Default Confluence space"
                className="w-auto min-w-40 shrink-0 gap-2 [&>span]:line-clamp-none"
              >
                <SelectValue
                  placeholder={spaces.isLoading ? 'Loading spaces…' : 'Choose a space'}
                />
              </SelectTrigger>
              <SelectContent className="min-w-max">
                {spaceItems.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          }
        />
      </div>
      <div className="flex flex-col gap-2 p-4">
        <div className="text-body tracking-body text-text">When an artifact changes</div>
        <RadioGroup
          aria-label="When an artifact changes"
          value={settings.value?.confluenceUpdateMode ?? ''}
          disabled={settings.isLoading || !settings.value}
          onValueChange={(next) =>
            settings.update({ confluenceUpdateMode: next as ConfluenceUpdateMode })
          }
          className="gap-1.5"
        >
          {UPDATE_MODES.map((mode) => (
            <label key={mode.value} className="flex cursor-pointer items-center gap-2">
              <RadioGroupItem value={mode.value} />
              <span className="text-tiny tracking-tiny text-text-muted">{mode.label}</span>
            </label>
          ))}
        </RadioGroup>
      </div>
    </div>
  );
}
