import React from 'react';
import { PRODUCT_NAME } from '@shared/app-identity';
import { usePublicUrls } from '@renderer/features/settings/use-public-urls';
import { useTelemetryConsent } from '@renderer/lib/hooks/useTelemetryConsent';
import { rpc } from '@renderer/lib/ipc';
import { Button } from '@renderer/lib/ui/button';
import { Switch } from '@renderer/lib/ui/switch';
import { SettingRow } from './SettingRow';

const TelemetryCard: React.FC = () => {
  const { prefEnabled, envDisabled, hasKeyAndHost, loading, setTelemetryEnabled } =
    useTelemetryConsent();
  const { data: publicUrls } = usePublicUrls();

  return (
    <SettingRow
      title="Anonymous usage data"
      description={
        <div>
          <p>Help improve {PRODUCT_NAME} by sending anonymous usage data.</p>
          <p>
            <span>See </span>
            <Button
              type="button"
              variant="link"
              size="sm"
              disabled={!publicUrls}
              className="group inline-flex h-auto items-center gap-1 px-0 text-body tracking-body font-normal text-text-muted hover:text-text hover:no-underline focus-visible:outline-none focus-visible:ring-0"
              onClick={() => {
                if (publicUrls) void rpc.app.openExternal(`${publicUrls.docs}/telemetry`);
              }}
            >
              <span className="transition-colors group-hover:text-text">Telemetry information</span>
              <span className="text-body tracking-body text-text-muted transition-colors group-hover:text-text">
                ↗
              </span>
            </Button>
            <span> for details.</span>
          </p>
          {!hasKeyAndHost && <p>Inactive in this build (no PostHog keys).</p>}
        </div>
      }
      control={
        <Switch
          checked={prefEnabled}
          onCheckedChange={async (checked) => {
            void import('../../../utils/telemetryClient').then(({ captureTelemetry }) => {
              captureTelemetry('setting_changed', { setting: 'telemetry' });
            });
            void setTelemetryEnabled(checked);
          }}
          disabled={loading || envDisabled}
          aria-label="Enable anonymous telemetry"
        />
      }
    />
  );
};

export default TelemetryCard;
