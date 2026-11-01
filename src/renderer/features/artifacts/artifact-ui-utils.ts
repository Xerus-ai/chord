import { avatarBgForName } from '@renderer/utils/color-palettes';

export { avatarBgForName as avatarColor };

/** Strip an email to its local part for display ("raghav@x.com" -> "raghav"). */
export function displayName(name: string): string {
  return name.includes('@') ? name.split('@')[0]! : name;
}

/** 1–2 letter initials for an avatar bubble. */
export function initials(name: string): string {
  const cleaned = displayName(name).trim();
  const parts = cleaned.split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0]!.charAt(0).toUpperCase();
  return (parts[0]!.charAt(0) + parts[parts.length - 1]!.charAt(0)).toUpperCase();
}

/**
 * Token class for initials inside an avatar of `diameter` px. Avatar initials
 * are sized optically to their circle, so the mapping lives here rather than
 * being re-derived per call site — two call sites previously disagreed on the
 * thresholds, which is why the same 24px avatar rendered at two sizes.
 */
export function avatarInitialsClass(diameter: number): string {
  if (diameter >= 28) return 'text-micro';
  if (diameter >= 24) return 'text-avatar-lg';
  if (diameter >= 20) return 'text-avatar-md';
  return 'text-avatar-sm';
}

/** Compact relative time: "just now", "5m ago", "3h ago", "Yesterday", "3d ago", "Mar 4". */
export function formatRelativeTime(date: number | string): string {
  const then = new Date(date).getTime();
  const diff = Date.now() - then;
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days === 1) return 'Yesterday';
  if (days < 7) return `${days}d ago`;
  return new Date(date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

/** Calendar bucket for grouping version-history entries ("Today" / "Yesterday" / "Earlier"). */
export function dateGroup(date: number | string): 'Today' | 'Yesterday' | 'Earlier' {
  const then = new Date(date);
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const t = then.getTime();
  if (t >= startOfToday) return 'Today';
  if (t >= startOfToday - 86400000) return 'Yesterday';
  return 'Earlier';
}
