import { posix } from 'node:path';

/**
 * A web project can name its icon in a source file rather than keep it at a
 * conventional path: `<link rel="icon" href="/brand.png">` in an HTML page, or
 * `{ rel: 'icon', href: 'mark.png' }` in a router's head config. These helpers
 * read that declaration and turn its href into repository paths to look at.
 */

/** A quoted rel value naming the page icon; each quote may be either kind. */
const ICON_REL_VALUE = `["'](?:icon|shortcut icon)["']`;

/** A quoted href value, captured up to its closing quote or its query string. */
const HREF_VALUE = `["']([^"'?]+)`;

/** How one declaration shape names its rel and its href. */
interface DeclarationPatterns {
  /** An icon rel (global). */
  rel: RegExp;
  /** The start of an href, up to its opening quote (global). */
  hrefKey: RegExp;
  /** A whole href read at one position (sticky). */
  hrefAt: RegExp;
}

const LINK_PATTERNS: DeclarationPatterns = {
  rel: new RegExp(`\\brel=${ICON_REL_VALUE}`, 'gi'),
  hrefKey: /\bhref=["']/gi,
  hrefAt: new RegExp(`href=${HREF_VALUE}`, 'iy'),
};

const OBJECT_PATTERNS: DeclarationPatterns = {
  rel: new RegExp(`\\brel\\s*:\\s*${ICON_REL_VALUE}`, 'gi'),
  hrefKey: /\bhref\s*:\s*["']/gi,
  hrefAt: new RegExp(`href\\s*:\\s*${HREF_VALUE}`, 'iy'),
};

const LINK_START = /<link\b/gi;

/** `https:`, `data:`, `C:` and the like: an href that names no repository file. */
const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

interface Attribute {
  start: number;
  end: number;
  value: string;
}

/** Every match of global `pattern` in `text`, overlapping ones included, shifted by `offset`. */
function findAttributes(pattern: RegExp, text: string, offset: number): Attribute[] {
  const found: Attribute[] = [];
  pattern.lastIndex = 0;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    const start = offset + match.index;
    found.push({ start, end: start + match[0].length, value: match[1] ?? '' });
    pattern.lastIndex = match.index + 1;
  }
  return found;
}

/** The match of sticky `pattern` at `index` in `source`, or `null`. */
function readAttributeAt(pattern: RegExp, source: string, index: number): Attribute | null {
  pattern.lastIndex = index;
  const match = pattern.exec(source);
  if (!match) return null;
  return { start: index, end: index + match[0].length, value: match[1] ?? '' };
}

/**
 * The declared href within `source[from, to)`: when an icon rel appears
 * anywhere in the span (even inside an href's own value), the last href that
 * starts in the span and has a value, read on past `to`.
 */
function pickDeclaredHref(
  source: string,
  patterns: DeclarationPatterns,
  from: number,
  to: number
): string | null {
  const span = source.slice(from, to);
  patterns.rel.lastIndex = 0;
  if (!patterns.rel.test(span)) return null;

  for (const hrefStart of findAttributes(patterns.hrefKey, span, from).reverse()) {
    const href = readAttributeAt(patterns.hrefAt, source, hrefStart.start);
    if (href) return href.value;
  }
  return null;
}

/**
 * The href of the first `<link>` declaring the icon. A link's tag ends at the
 * first `>` after `<link`, even past a later `<link`; a link with no `>` after
 * it declares nothing.
 */
function readLinkHref(source: string): string | null {
  let tagEnd = -1;
  for (const match of source.matchAll(LINK_START)) {
    // A link starting inside the tag just tried holds a subset of its attributes: it fails too.
    if (match.index < tagEnd) continue;
    tagEnd = source.indexOf('>', match.index + match[0].length);
    if (tagEnd === -1) return null;
    const href = pickDeclaredHref(source, LINK_PATTERNS, match.index, tagEnd);
    if (href) return href;
  }
  return null;
}

/** The href of the first `rel`/`href` key pair between two `}`. */
function readObjectHref(source: string): string | null {
  let from = 0;
  for (;;) {
    const close = source.indexOf('}', from);
    const to = close === -1 ? source.length : close;
    const href = pickDeclaredHref(source, OBJECT_PATTERNS, from, to);
    if (href) return href;
    if (close === -1) return null;
    from = close + 1;
  }
}

/**
 * Returns the href of the first icon declaration in `source`, or `null`.
 * An HTML `<link>` anywhere in the source takes precedence over an object
 * literal, so a page that carries both is read the way a browser reads it.
 */
export function extractDeclaredIconHref(source: string): string | null {
  return readLinkHref(source) ?? readObjectHref(source);
}

/**
 * Returns the repository-relative paths an icon href could live at, most
 * likely first. `sourceFile` is the declaring file's repository path. A
 * root-absolute href is served from `public/` or the repository root; a
 * relative one is also tried next to the declaring file. Hrefs that point
 * outside the repository (other hosts, schemes, `..`) give no paths at all.
 */
export function declaredIconHrefCandidates(href: string, sourceFile: string): string[] {
  const path = href.trim().replace(/[?#][\s\S]*$/, '');
  if (path === '' || path.startsWith('//') || URL_SCHEME.test(path)) return [];

  const isRootAbsolute = path.startsWith('/');
  const segments = path
    .replaceAll('\\', '/')
    .split('/')
    .filter((segment) => segment !== '' && segment !== '.');
  if (segments.length === 0 || segments.includes('..')) return [];

  const relativePath = segments.join('/');
  const candidates: string[] = [];
  if (!isRootAbsolute) {
    const sourceDirectory = posix.dirname(sourceFile);
    if (sourceDirectory !== '.') candidates.push(posix.join(sourceDirectory, relativePath));
  }
  candidates.push(`public/${relativePath}`, relativePath);
  return [...new Set(candidates)];
}
