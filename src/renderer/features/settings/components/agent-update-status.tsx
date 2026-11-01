import { AlertTriangle, ArrowUpCircle } from 'lucide-react';
import type { AgentUpdateInfo } from '@shared/agent-updates';
import { FoldedOutput } from '@renderer/lib/components/folded-output';
import { Button } from '@renderer/lib/ui/button';
import { Spinner } from '@renderer/lib/ui/spinner';

/**
 * The update parts of an agent row in Settings › Agents & models
 * (devstation-ext): the installed version, "installed → latest" when a newer
 * release is out, the Update button, and a failed update's error.
 */

/** The installed version, or "installed → latest" when a newer release is out. */
export function AgentVersion({
  installedVersion,
  update,
}: {
  installedVersion: string;
  update: AgentUpdateInfo | undefined;
}) {
  const behind = update?.updateAvailable === true;
  return (
    <span className="font-mono text-tiny tracking-tiny text-text-muted">
      {behind ? `${installedVersion} → ${update.latestVersion}` : installedVersion}
    </span>
  );
}

/** "Update" for an agent behind its latest release; nothing otherwise. */
export function AgentUpdateButton({
  agentName,
  update,
  isUpdating,
  onUpdate,
}: {
  agentName: string;
  update: AgentUpdateInfo | undefined;
  isUpdating: boolean;
  onUpdate: () => void;
}) {
  if (!update?.updateAvailable) return null;
  return (
    <Button
      type="button"
      variant="outline"
      size="xs"
      disabled={isUpdating}
      aria-label={
        isUpdating ? `Updating ${agentName}…` : `Update ${agentName} to ${update.latestVersion}`
      }
      onClick={onUpdate}
    >
      {isUpdating ? <Spinner size="sm" aria-hidden="true" /> : <ArrowUpCircle aria-hidden="true" />}
      {isUpdating ? 'Updating…' : 'Update'}
    </Button>
  );
}

/** A failed update: what went wrong, with the command's output folded away. */
export function AgentUpdateError({
  agentName,
  message,
  output,
}: {
  agentName: string;
  message: string;
  output: string | undefined;
}) {
  return (
    <div role="alert" className="rounded-md border border-status-err-border bg-status-err-bg p-3">
      <div className="flex items-center gap-2 text-body tracking-body font-semibold text-status-err">
        <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
        {agentName} update failed
      </div>
      <p className="mt-1 break-words text-tiny tracking-tiny text-text-passive">{message}</p>
      {output ? <FoldedOutput className="mt-2" label="Show output" output={output} /> : null}
    </div>
  );
}
