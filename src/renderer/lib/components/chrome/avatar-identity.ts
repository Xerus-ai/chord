import { hashString } from '@renderer/utils/color-palettes';
import { cssVarRef } from '@renderer/utils/cssVars';

/**
 * Identity badges draw from the fixed ten-colour identity table, not from the
 * theme palette. The table is held to one contrast band
 * so a colour identifies a person rather than ranking them, and it is
 * theme-independent by design: the same user is the same colour in both
 * schemes. Two shapes, two problems:
 *
 * - `participantColor` is the FILL used under a white letter (avatar circles).
 * - `identityForeground` is the GLYPH/LABEL colour painted straight on a row,
 *   which the fill table cannot serve — no single hex clears 4.5:1 against
 *   both a near-white and a dark surface — so it comes from the per-scheme
 *   `--identity-fg-*` set, hue unchanged.
 */
const IDENTITY_SLOT_COUNT = 10;

function identitySlot(key: string): number {
  return (hashString(key) % IDENTITY_SLOT_COUNT) + 1;
}

export function participantColor(userId: string): { bg: string; fg: string } {
  return {
    bg: cssVarRef(`--identity-${identitySlot(userId)}`),
    fg: cssVarRef('--identity-foreground-on-fill'),
  };
}

/** The identity colour as a foreground, for a glyph or label on a row. */
export function identityForeground(key: string): string {
  return cssVarRef(`--identity-fg-${identitySlot(key)}`);
}

export function participantInitials(name: string | null, email: string): string {
  if (name) {
    return name
      .split(' ')
      .map((w) => w[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  }
  return email.slice(0, 2).toUpperCase();
}
