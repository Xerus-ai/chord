import { Loader2, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@renderer/lib/ui/select';
import { avatarBgForName } from '@renderer/utils/color-palettes';
import { ACCESS_ROLE_LABELS, type MemberRole } from './sharing-api';

interface ShareMemberRowProps {
  name: string | null;
  email: string;
  avatarUrl: string | null;
  /** 'author' renders a fixed label; a member role is editable when canManage; null shows none. */
  role: MemberRole | 'author' | null;
  /** Beside the name: how they reach it ("via work item", "2 artifacts"). */
  tag?: ReactNode;
  pending?: boolean;
  canManage: boolean;
  onRoleChange?: (role: MemberRole) => Promise<void>;
  onRemove?: () => Promise<void>;
}

/** One person in the share modal's "People with access" list. */
export function ShareMemberRow({
  name,
  email,
  avatarUrl,
  role,
  tag,
  pending = false,
  canManage,
  onRoleChange,
  onRemove,
}: ShareMemberRowProps) {
  const [busy, setBusy] = useState(false);
  const label = name ?? email;

  async function run(action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  const editable = canManage && role !== 'author' && role !== null && onRoleChange;

  return (
    <div className="group flex items-center gap-3 py-2">
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-8 w-8 shrink-0 rounded-full" />
      ) : (
        <div
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-tiny font-bold leading-none tracking-tiny text-white"
          style={{ background: avatarBgForName(label) }}
        >
          {label[0]?.toUpperCase() ?? '?'}
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="flex min-w-0 items-center gap-1.5">
          <span className="truncate text-body font-semibold tracking-body text-text">{label}</span>
          {tag}
        </span>
        <span className="truncate text-tiny tracking-tiny text-text-passive">
          {pending ? `${email} · Invited to the team` : email}
        </span>
      </div>

      {role === 'author' ? (
        <span className="shrink-0 px-2 text-tiny font-medium tracking-tiny text-text-muted">
          Author
        </span>
      ) : editable ? (
        <Select
          value={role}
          disabled={busy}
          onValueChange={(value) => void run(() => onRoleChange(value as MemberRole))}
        >
          <SelectTrigger size="sm" aria-label={`Access for ${label}`} className="w-28 shrink-0">
            <SelectValue>{(value: MemberRole) => ACCESS_ROLE_LABELS[value]}</SelectValue>
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="view">{ACCESS_ROLE_LABELS.view}</SelectItem>
            <SelectItem value="edit">{ACCESS_ROLE_LABELS.edit}</SelectItem>
          </SelectContent>
        </Select>
      ) : role === null ? null : (
        <span className="shrink-0 px-2 text-tiny font-medium tracking-tiny text-text-muted">
          {ACCESS_ROLE_LABELS[role]}
        </span>
      )}

      {canManage && role !== 'author' && role !== null && onRemove && (
        <button
          type="button"
          onClick={() => void run(onRemove)}
          disabled={busy}
          aria-label={`Remove ${label}`}
          className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-full border-none bg-transparent text-text-passive opacity-0 transition-all duration-100 hover:bg-status-err/10 hover:text-status-err group-hover:opacity-100 disabled:cursor-default"
        >
          {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}
