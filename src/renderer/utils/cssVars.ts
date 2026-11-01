/**
 * A token as a CSS value (`var(--name)`), for a style prop. Prefer it to
 * `cssVar`: it costs nothing to render and follows a theme change by itself,
 * where reading the computed value forces a style recalculation on every
 * render that calls it (avatars in every chat row and sidebar tile).
 */
export function cssVarRef(name: string): string {
  return `var(${name})`;
}

/** A token's computed value, for consumers that cannot take `var()`: xterm, canvas, peers. */
export function cssVar(name: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
