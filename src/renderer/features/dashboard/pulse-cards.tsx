import React from 'react';
import { MemberAvatar } from '@renderer/features/dashboard/member-avatar';
import type { TeamActivity, TeamPulseSummary } from '@renderer/lib/cloud-team-api';
import { cn } from '@renderer/utils/utils';

function PrLink({ text }: { text: string }) {
  return <span className="font-mono text-text">{text}</span>;
}

function RichSummaryText({ text, prRefs }: { text: string; prRefs: unknown[] }) {
  const refMap = new Map<number, string>();
  for (const ref of prRefs as Array<{ url: string; title: string }>) {
    const num = parseInt(ref.title.replace('#', ''), 10);
    if (!isNaN(num)) refMap.set(num, ref.url);
  }

  const parts = text.split(/((?:PR\s)?#\d+)/g);

  return (
    <p className="mt-0.5 text-tiny tracking-tiny leading-relaxed text-text-passive">
      {parts.map((part, i) => {
        const match = part.match(/(?:PR\s)?#(\d+)/);
        if (match) {
          const num = parseInt(match[1], 10);
          const url = refMap.get(num);
          if (url) {
            return (
              <a
                key={i}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="cursor-pointer font-mono text-text transition-colors hover:underline"
              >
                {part}
              </a>
            );
          }
          return <PrLink key={i} text={part} />;
        }
        return <React.Fragment key={i}>{part}</React.Fragment>;
      })}
    </p>
  );
}

export function PulseCard({ summary }: { summary: TeamPulseSummary }) {
  const displayName = summary.user_name ?? summary.user_email.split('@')[0] ?? 'Unknown';

  return (
    <div className="flex gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover">
      <MemberAvatar name={displayName} avatarUrl={summary.user_avatar} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="text-body tracking-body font-medium text-text">{displayName}</div>
        <RichSummaryText text={summary.summary} prRefs={summary.pr_refs ?? []} />
      </div>
    </div>
  );
}

export function ActivityRow({ member }: { member: TeamActivity }) {
  const displayName = member.user_name ?? member.user_email.split('@')[0] ?? 'Unknown';
  const isOnline = member.status === 'online';

  return (
    <div className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-surface-hover">
      <div className="relative">
        <MemberAvatar name={displayName} avatarUrl={member.user_avatar} size="sm" />
        <span
          className={cn(
            'absolute -bottom-0.5 -right-0.5 size-2.5 rounded-full border-2 border-surface',
            isOnline ? 'bg-status-ok' : 'bg-text-passive/40'
          )}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div className="truncate text-body tracking-body font-medium text-text">{displayName}</div>
        <div className="truncate text-tiny tracking-tiny text-text-passive">
          {member.active_view ? `In ${member.active_view}` : isOnline ? 'Online' : 'Offline'}
        </div>
      </div>
    </div>
  );
}
