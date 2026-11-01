import type { RepoIcon } from '@shared/repo-icons';
import { participantColor } from '@renderer/lib/components/chrome/avatar-identity';
import { cn } from '@renderer/utils/utils';
import { REPO_ICON_COMPONENTS } from './repo-icon-map';

/**
 * A repository's identity: the image auto-detected from the repository or its
 * GitHub owner, the glyph its owner chose, or — failing both — its initial, on
 * a colour derived from its id, so the same repo is the same swatch wherever it
 * appears. The group header wears it at 16px; a Status-view row wears it at
 * 14px in the right-hand column, where it is the only thing saying which repo
 * the row belongs to.
 *
 * A lucide glyph replaces the letter INSIDE the tinted tile, because the colour
 * is the identity and a bare glyph would lose it. A detected IMAGE fills the
 * whole tile instead and is not tinted: it is the project's own mark, and a
 * colour wash over it would only make it harder to recognise.
 *
 * Its own file rather than a local in `sidebar-section.tsx` because several
 * unrelated surfaces render it, and a second copy is how they start disagreeing
 * about the colour of a repo.
 */
export function RepoIdentityTile({
  repoId,
  label,
  icon = null,
  className,
}: {
  repoId: string;
  label: string;
  icon?: RepoIcon | null;
  className?: string;
}) {
  const tileClassName = cn(
    'flex size-icon-md shrink-0 items-center justify-center overflow-hidden rounded-xs text-micro font-medium leading-none',
    className
  );

  if (icon?.type === 'image') {
    return (
      <img
        src={icon.src}
        // The label is already on the tile's `title`, and the tile sits beside
        // the repo name everywhere it appears — announcing it twice is noise.
        alt=""
        title={label}
        draggable={false}
        className={cn(tileClassName, 'object-cover')}
      />
    );
  }

  const { bg, fg } = participantColor(repoId);
  const Icon = icon?.type === 'lucide' ? REPO_ICON_COMPONENTS[icon.key] : null;
  return (
    <span title={label} className={tileClassName} style={{ background: bg, color: fg }}>
      {Icon ? <Icon className="size-3" strokeWidth={1.75} /> : label.charAt(0).toUpperCase()}
    </span>
  );
}
