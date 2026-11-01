import { AlertCircle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react';
import React from 'react';
import { PRODUCT_NAME } from '@shared/app-identity';
import { getProgressLabel, useUpdateStore } from '@renderer/lib/stores/update-store';
import { Badge } from '@renderer/lib/ui/badge';
import { Button } from '@renderer/lib/ui/button';
import { formatBytes } from '@renderer/utils/formatBytes';
import { SettingRow } from './SettingRow';

export function UpdateCard(): React.JSX.Element {
  const updateState = useUpdateStore((s) => s.state);
  const currentVersion = useUpdateStore((s) => s.currentVersion);
  const check = useUpdateStore((s) => s.check);
  const download = useUpdateStore((s) => s.download);
  const install = useUpdateStore((s) => s.install);

  const downloadProgress = updateState.status === 'downloading' ? updateState.progress : undefined;
  const hasByteProgress =
    downloadProgress !== undefined &&
    ((downloadProgress.total ?? 0) > 0 || (downloadProgress.transferred ?? 0) > 0);

  const versionTitle = (
    <div className="flex items-center gap-2">
      Version
      {currentVersion && (
        <Badge variant="outline" className="h-5 px-2 font-mono text-tiny tracking-tiny">
          v{currentVersion}
        </Badge>
      )}
    </div>
  );

  return (
    <div className="grid gap-3">
      <SettingRow
        title={versionTitle}
        description={renderStatusMessage()}
        control={
          <div className="flex items-center gap-2">
            {updateState.status !== 'downloaded' && updateState.status !== 'installing' && (
              <Button
                type="button"
                variant="outline"
                size="icon-sm"
                onClick={() => check()}
                disabled={updateState.status === 'checking'}
                aria-label="Check for updates"
              >
                <RefreshCw
                  className={`h-3 w-3 ${updateState.status === 'checking' ? 'animate-spin' : ''}`}
                />
              </Button>
            )}
            {renderAction()}
          </div>
        }
      />

      {updateState.status === 'downloading' && downloadProgress && (
        <div className="space-y-2">
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-inset">
            <div
              className="h-full bg-action-bg transition-all duration-300 ease-out"
              style={{ width: `${downloadProgress.percent || 0}%` }}
            />
          </div>
          {hasByteProgress && (
            <p className="text-tiny tracking-tiny text-text-muted">
              {formatBytes(downloadProgress.transferred || 0)} /{' '}
              {formatBytes(downloadProgress.total || 0)}
            </p>
          )}
        </div>
      )}
    </div>
  );

  function renderStatusMessage() {
    const progressLabel = getProgressLabel();

    switch (updateState.status) {
      case 'checking':
        return (
          <p className="flex items-center gap-1 text-body tracking-body text-text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            Checking for updates...
          </p>
        );

      case 'available':
        if (updateState.info?.version) {
          return (
            <p className="text-body tracking-body text-text-muted">
              Version {updateState.info.version} is available
            </p>
          );
        }
        return <p className="text-body tracking-body text-text-muted">An update is available</p>;

      case 'downloading':
        return (
          <p className="text-body tracking-body text-text-muted">
            Downloading update{progressLabel ? ` (${progressLabel})` : '...'}
          </p>
        );

      case 'downloaded':
        return (
          <p className="flex items-center gap-1 text-body tracking-body text-status-ok">
            <CheckCircle2 className="h-3 w-3" />
            Update ready. Restart {PRODUCT_NAME} to use the new version.
          </p>
        );

      case 'installing':
        return (
          <p className="flex items-center gap-1 text-body tracking-body text-text-muted">
            <Loader2 className="h-3 w-3 animate-spin" />
            Installing update. {PRODUCT_NAME} will close and restart automatically — this may take a
            few seconds.
          </p>
        );

      case 'error':
        return (
          <div className="flex flex-col items-start gap-1">
            <Badge
              variant="outline"
              className="border-status-warn/40 bg-status-warn/10 text-status-warn"
            >
              <AlertCircle className="h-3 w-3" />
              Update check failed
            </Badge>
            <p className="text-tiny tracking-tiny text-text-muted">
              {updateState.message} — use the refresh button to try again.
            </p>
          </div>
        );

      default:
        return (
          <p className="flex items-center gap-1 text-body tracking-body text-text-muted">
            <CheckCircle2 className="h-3 w-3 text-status-ok" />
            You're up to date.{' '}
          </p>
        );
    }
  }

  function renderAction() {
    switch (updateState.status) {
      case 'available':
        return (
          <Button size="xs" variant="default" onClick={() => download()}>
            <Download className="mr-1.5 h-3 w-3" />
            Download
          </Button>
        );

      case 'downloading':
        return (
          <Button size="xs" variant="outline" disabled>
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            Downloading
          </Button>
        );

      case 'downloaded':
        return (
          <Button size="xs" variant="default" onClick={() => install()}>
            <RefreshCw className="mr-1.5 h-3 w-3" />
            Restart
          </Button>
        );

      case 'installing':
        return (
          <Button size="xs" variant="outline" disabled>
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            Installing
          </Button>
        );

      default:
        return null;
    }
  }
}
