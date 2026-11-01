import { cssVar, cssVarRef } from './cssVars';

const AVATAR_KEYS = [
  { bg: '--identity-self-bg', fg: '--identity-self-fg' },
  { bg: '--identity-peer-1-bg', fg: '--identity-peer-1-fg' },
  { bg: '--identity-peer-2-bg', fg: '--identity-peer-2-fg' },
  { bg: '--identity-peer-3-bg', fg: '--identity-peer-3-fg' },
  { bg: '--identity-peer-4-bg', fg: '--identity-peer-4-fg' },
  { bg: '--identity-peer-5-bg', fg: '--identity-peer-5-fg' },
  { bg: '--identity-peer-6-bg', fg: '--identity-peer-6-fg' },
  { bg: '--identity-peer-7-bg', fg: '--identity-peer-7-fg' },
] as const;

const CURSOR_KEYS = [
  '--identity-cursor-1',
  '--identity-cursor-2',
  '--identity-cursor-3',
  '--identity-cursor-4',
  '--identity-cursor-5',
  '--identity-cursor-6',
  '--identity-cursor-7',
  '--identity-cursor-8',
] as const;

/** Exported so the identity table in `avatar-identity.ts` slots a given user
 * the same way this file's avatar and cursor tables do — one hash, not three. */
export function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 31 + str.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

export function avatarColorForUser(key: string): { bg: string; fg: string } {
  const slot = AVATAR_KEYS[hashString(key) % AVATAR_KEYS.length]!;
  return { bg: cssVarRef(slot.bg), fg: cssVarRef(slot.fg) };
}

export function avatarBgForName(name: string): string {
  const slot = AVATAR_KEYS[hashString(name) % AVATAR_KEYS.length]!;
  return cssVarRef(slot.fg);
}

export function cursorColorForUser(userId: string): string {
  const key = CURSOR_KEYS[hashString(userId) % CURSOR_KEYS.length]!;
  return cssVar(key);
}
