import { FEATURE_FLAGS, type FeatureFlag } from '@chord/protocol';
import { AlertCircle } from 'lucide-react';
import React from 'react';
import { useFeatureFlags } from '@renderer/lib/feature-flags/use-feature-flag';
import { Badge } from '@renderer/lib/ui/badge';
import { SettingRow } from './SettingRow';

type RowState = 'on' | 'off' | 'pending' | 'error';

/**
 * Preview features (devstation-mg6u.90): each feature still behind a flag, and whether the sync
 * server has turned it on for this app. Read-only: the server decides. Until main answers the
 * state is not shown, and a failed read says so, so neither looks like the server saying off
 * (devstation-mg6u.95).
 */
export function PreviewFeaturesCard(): React.JSX.Element {
  const { data: flags, isPending, isError } = useFeatureFlags();
  return (
    <div className="grid gap-3">
      {(Object.keys(FEATURE_FLAGS) as FeatureFlag[]).map((flag) => {
        const state: RowState = isError
          ? 'error'
          : isPending
            ? 'pending'
            : flags?.[flag] === true
              ? 'on'
              : 'off';
        return (
          <div key={flag} data-testid={`feature-flag-${flag}`} data-state={state}>
            <SettingRow
              title={FEATURE_FLAGS[flag].title}
              description="The Chord server turns this on while the feature is in preview."
              control={<FlagBadge state={state} />}
            />
          </div>
        );
      })}
    </div>
  );
}

function FlagBadge({ state }: { state: RowState }): React.JSX.Element {
  switch (state) {
    case 'on':
      // The page's positive state (UpdateCard's up-to-date check), so On never reads like Off.
      return (
        <Badge
          variant="outline"
          className="border-status-ok/40 bg-status-ok/10 text-tiny tracking-tiny text-status-ok"
        >
          On
        </Badge>
      );
    case 'off':
      return (
        <Badge variant="secondary" className="text-tiny tracking-tiny">
          Off
        </Badge>
      );
    case 'error':
      return (
        <Badge
          variant="outline"
          className="border-status-warn/40 bg-status-warn/10 text-tiny tracking-tiny text-status-warn"
        >
          <AlertCircle className="h-3 w-3" />
          Could not read
        </Badge>
      );
    case 'pending':
      return (
        <span className="text-tiny tracking-tiny text-text-muted" aria-label="Checking">
          …
        </span>
      );
  }
}
