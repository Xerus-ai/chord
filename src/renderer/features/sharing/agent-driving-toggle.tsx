import { ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cloudApi } from '@renderer/lib/cloud-api';
import { Switch } from '@renderer/lib/ui/switch';

/**
 * approval_policy — author only. Can edit lets a member chat with the agent;
 * who may DRIVE it (prompt, interrupt, answer its permission requests) stays
 * this per-work-item switch, enforced by server/src/routes/commands.ts.
 */
export function AgentDrivingToggle({
  workItemId,
  onError,
}: {
  workItemId: string;
  onError: (message: string) => void;
}) {
  const [policy, setPolicy] = useState<'owner' | 'participants' | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let current = true;
    cloudApi
      .getWorkItem(workItemId)
      .then((item) => {
        // Only the owner manages sharing, and the owner reaches the whole item.
        if (item.access_scope !== 'work_item') {
          throw new Error(`Work item ${workItemId} answered as artifacts only to its owner`);
        }
        if (current) setPolicy(item.approval_policy === 'participants' ? 'participants' : 'owner');
      })
      .catch((e: unknown) => onError(e instanceof Error ? e.message : 'Failed to load approvals'));
    return () => {
      current = false;
    };
  }, [workItemId, onError]);

  async function toggle(enabled: boolean) {
    const next = enabled ? 'participants' : 'owner';
    const previous = policy;
    setSaving(true);
    setPolicy(next);
    try {
      await cloudApi.updateApprovalPolicy(workItemId, next);
    } catch (e) {
      setPolicy(previous);
      onError(e instanceof Error ? e.message : 'Failed to update approvals');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex items-center gap-3 py-1">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover-solid">
        <ShieldCheck className="h-4 w-4 text-text-passive" />
      </div>
      <div className="flex flex-1 flex-col gap-[1px]">
        <span className="text-body font-semibold tracking-body text-text">
          Let editors drive the agent
        </span>
        <span className="text-tiny tracking-tiny text-text-passive">
          {policy === 'participants'
            ? 'People who can edit can prompt the agent, interrupt it and approve its tool requests'
            : 'Only you can prompt the agent and approve its tool requests'}
        </span>
      </div>
      <Switch
        checked={policy === 'participants'}
        disabled={saving || policy === null}
        onCheckedChange={(enabled) => void toggle(enabled)}
      />
    </div>
  );
}
