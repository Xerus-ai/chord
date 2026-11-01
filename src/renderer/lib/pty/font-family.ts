/**
 * Cross-platform monospace fallback chain. A terminal MUST render in a
 * fixed-width font: if the configured family is unavailable, the browser
 * substitutes a proportional font whose glyphs are narrower than xterm's
 * measured cell, producing wildly-spaced, unreadable output. This chain
 * guarantees a real monospace font on every OS (macOS → Menlo/Monaco,
 * Windows → Consolas, Linux → DejaVu/generic monospace).
 */
export const MONO_FONT_STACK =
  "'Commit Mono', Menlo, Monaco, Consolas, 'DejaVu Sans Mono', 'Courier New', monospace";

/** The families of a CSS font stack, unquoted and trimmed. */
function stackFamilies(stack: string): string[] {
  return stack.split(',').map((family) => family.trim().replace(/^'|'$/g, ''));
}

/**
 * Build a safe xterm fontFamily from an optional user-configured family.
 * The chosen family is tried first, then always falls back through the
 * cross-platform monospace chain so a missing font (e.g. 'Menlo' on Windows)
 * degrades to a real monospace font instead of a broken proportional default.
 */
export function buildFontFamily(preferred?: string | null): string {
  const trimmed = preferred?.trim().replace(/'/g, '');
  if (!trimmed) return MONO_FONT_STACK;
  // A family already in the stack is not put in front of it again. Compared as
  // whole family names: 'DejaVu Sans' is not 'DejaVu Sans Mono'.
  const wanted = trimmed.toLowerCase();
  const alreadyIncluded = stackFamilies(MONO_FONT_STACK).some(
    (family) => family.toLowerCase() === wanted
  );
  return alreadyIncluded ? MONO_FONT_STACK : `'${trimmed}', ${MONO_FONT_STACK}`;
}
