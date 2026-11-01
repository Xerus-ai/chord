import { avatarColor, avatarInitialsClass, initials } from './artifact-ui-utils';

/** Shared pieces of the artifact tab's floating cards (comments-card.tsx, versions-card.tsx). */

export function Avatar({ name, size, ring }: { name: string; size: number; ring?: boolean }) {
  return (
    <span
      className={`flex items-center justify-center rounded-full font-bold text-white ${avatarInitialsClass(size)}`}
      style={{
        width: size,
        height: size,
        background: avatarColor(name),
        boxShadow: ring ? '0 0 0 1.5px var(--surface)' : undefined,
      }}
    >
      {initials(name)}
    </span>
  );
}

export function EmptyState({
  title,
  body,
  icon,
}: {
  title: string;
  body: string;
  icon: React.ReactNode;
}) {
  return (
    <div className="m-auto flex flex-col items-center gap-2 px-4 text-center">
      <span className="mb-1 flex h-9 w-9 items-center justify-center rounded-full bg-surface-inset text-text-passive">
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          {icon}
        </svg>
      </span>
      <p className="text-body tracking-body font-medium text-text-muted">{title}</p>
      <p className="max-w-[220px] text-tiny tracking-tiny leading-[1.5] text-text-passive">
        {body}
      </p>
    </div>
  );
}

/** A read that failed must never render as an empty list. */
export function PanelError({ message }: { message: string }) {
  return (
    <p role="alert" className="px-1 py-6 text-center text-tiny tracking-tiny text-status-err">
      {message}
    </p>
  );
}
