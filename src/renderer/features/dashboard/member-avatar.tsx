import { avatarColorForUser } from '@renderer/utils/color-palettes';

export function MemberAvatar({
  name,
  avatarUrl,
  size = 'sm',
}: {
  name: string;
  avatarUrl: string | null;
  /** `xs` is the sidebar row's leading tile. */
  size?: 'xs' | 'sm' | 'md';
}) {
  const px = size === 'md' ? 'h-8 w-8' : size === 'sm' ? 'h-6 w-6' : 'size-4';
  const textSize =
    size === 'md'
      ? 'text-tiny tracking-tiny'
      : size === 'sm'
        ? 'text-micro tracking-micro'
        : 'text-micro leading-none';

  if (avatarUrl) {
    return (
      <img src={avatarUrl} alt={name} className={`${px} shrink-0 rounded-full object-cover`} />
    );
  }

  const initials = name
    .split(' ')
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const { bg, fg } = avatarColorForUser(name);

  return (
    <div
      className={`flex ${px} shrink-0 items-center justify-center rounded-full ${textSize} font-bold`}
      style={{ background: bg, color: fg }}
    >
      {initials || name[0]?.toUpperCase() || '?'}
    </div>
  );
}
