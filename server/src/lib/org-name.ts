/**
 * Consumer email providers. An organization WorkOS auto-named after one of
 * these is meaningless — nobody's company is called "gmail.com" — so it is the
 * one case where we override the name WorkOS gave us.
 *
 * Corporate domains are deliberately absent: an org genuinely named "acme.com"
 * may be a real shared workspace whose name its admin chose, and renaming it
 * would rename it for every member. Those are fixed from Settings › Team
 * instead.
 */
const PUBLIC_EMAIL_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'msn.com',
  'yahoo.com',
  'ymail.com',
  'icloud.com',
  'me.com',
  'mac.com',
  'aol.com',
  'proton.me',
  'protonmail.com',
  'pm.me',
  'gmx.com',
  'mail.com',
  'zoho.com',
  'yandex.com',
  'fastmail.com',
  'hey.com',
]);

/**
 * The name to store for an organization we did not create ourselves.
 *
 * WorkOS names an org it creates after the signup email's domain, so an
 * account opened with a personal address lands in a workspace literally called
 * "gmail.com". We adopt WorkOS's name in every other case — it is the source
 * of truth for org identity — and substitute a personal one only here.
 *
 * The domain match is exact, never a "looks like a hostname" heuristic.
 */
export function resolveAdoptedOrgName(
  workosName: string,
  email: string | null | undefined,
  displayName: string
): string {
  const domain = email?.split('@')[1]?.trim().toLowerCase();
  if (!domain || !PUBLIC_EMAIL_DOMAINS.has(domain)) return workosName;
  if (workosName.trim().toLowerCase() !== domain) return workosName;
  return `${displayName}'s workspace`;
}
