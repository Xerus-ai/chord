import { FEATURE_FLAGS, type FeatureFlag } from '@chord/protocol';
import React from 'react';
import { useFeatureFlags } from '@renderer/lib/feature-flags/use-feature-flag';
import { Badge } from '@renderer/lib/ui/badge';
import { SettingRow } from './SettingRow';

/**
 * Preview features (devstation-mg6u.90): each feature still behind a flag, and whether the sync
 * server has turned it on for this app. Read-only: the server decides.
 */
export function PreviewFeaturesCard(): React.JSX.Element {
  const { data: flags } = useFeatureFlags();
  return (
    <div className="grid gap-3">
      {(Object.keys(FEATURE_FLAGS) as FeatureFlag[]).map((flag) => {
        const on = flags?.[flag] === true;
        return (
          <div key={flag} data-testid={`feature-flag-${flag}`} data-state={on ? 'on' : 'off'}>
            <SettingRow
              title={FEATURE_FLAGS[flag].title}
              description="Turned on by the Chord server while the feature is in preview."
              control={
                <Badge variant={on ? 'outline' : 'secondary'} className="h-5 px-2 text-tiny">
                  {on ? 'On' : 'Off'}
                </Badge>
              }
            />
          </div>
        );
      })}
    </div>
  );
}
