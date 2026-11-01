import type { WorkItemViewer } from '@renderer/features/work-list/use-viewing-presence';
import { avatarColor, displayName, initials } from './artifact-ui-utils';

const MAX_AVATARS = 4;

export function PresenceAvatars({ viewers }: { viewers: WorkItemViewer[] }) {
  if (viewers.length === 0) return null;

  const shown = viewers.slice(0, MAX_AVATARS);
  const overflow = viewers.length - shown.length;

  return (
    <div className="flex shrink-0 items-center gap-1">
      <div className="flex">
        {shown.map((viewer, i) => {
          const label = viewer.name ?? viewer.email;
          return (
            <div
              key={viewer.user_id}
              title={displayName(label)}
              className={`flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-surface-raised text-micro tracking-micro font-semibold text-white ${i > 0 ? '-ml-[6px]' : ''}`}
              style={{ backgroundColor: avatarColor(label), zIndex: shown.length - i }}
            >
              {initials(label)}
            </div>
          );
        })}
        {overflow > 0 && (
          <div
            className="-ml-[6px] flex h-[26px] w-[26px] items-center justify-center rounded-full border-2 border-surface-raised bg-surface-hover-solid text-micro tracking-micro font-semibold text-text-muted"
            style={{ zIndex: 0 }}
          >
            +{overflow}
          </div>
        )}
      </div>
      <span className="h-[6px] w-[6px] shrink-0 rounded-full bg-status-ok-active" />
      {/* One line: in a crowded file bar it broke as "1" over "editor" (devstation-nvt). */}
      <span className="whitespace-nowrap text-tiny tracking-tiny text-text-passive">
        {viewers.length} {viewers.length === 1 ? 'editor' : 'editors'}
      </span>
    </div>
  );
}
