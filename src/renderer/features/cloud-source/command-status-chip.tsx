import type { CommandStatusEntry } from './use-command-statuses';

interface CommandStatusChipProps {
  entry: CommandStatusEntry | undefined;
  /** creator_device_online — pending + offline renders "agent offline". */
  deviceOnline: boolean;
}

/**
 * Per-prompt delivery chip (design doc §5): queued (pending — "agent
 * offline" when no device socket is connected for the owner), delivered
 * (claimed), done (acked), failed/expired with the reason inline. Follows
 * the header's inline-pill convention (`work-item-header.tsx`) — token classes only.
 */
export function CommandStatusChip({ entry, deviceOnline }: CommandStatusChipProps) {
  // No entry yet: the seed is in flight or the broadcast raced the render —
  // the POST succeeded (the message row exists), so it is at least queued.
  const status = entry?.status ?? 'pending';

  let label: string;
  let tone: 'neutral' | 'active' | 'done' | 'error';
  switch (status) {
    case 'pending':
      label = deviceOnline ? 'Queued' : 'Queued — agent offline';
      tone = 'neutral';
      break;
    case 'claimed':
      label = 'Delivered';
      tone = 'active';
      break;
    case 'acked':
      label = 'Done';
      tone = 'done';
      break;
    case 'expired':
      label = 'Expired';
      tone = 'error';
      break;
    case 'failed':
      label = entry?.status_reason ? `Failed — ${entry.status_reason}` : 'Failed';
      tone = 'error';
      break;
    default:
      label = status;
      tone = 'neutral';
  }

  const toneClasses =
    tone === 'error'
      ? 'border-border bg-status-err-bg text-status-err'
      : tone === 'done'
        ? 'border-status-ok/20 bg-status-ok/10 text-status-ok'
        : tone === 'active'
          ? 'border-border bg-surface-inset text-text'
          : 'border-border bg-surface-inset text-text-muted';

  return (
    <span
      className={`inline-flex w-fit items-center rounded-xs border px-1.5 py-0 text-micro tracking-micro font-medium ${toneClasses}`}
    >
      {label}
    </span>
  );
}
