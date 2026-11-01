import { readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { contentTypeForPath } from './page-response-headers';
import { isPathInside, isRealPathInside } from './path-containment';

/**
 * Local assets of a web page, read for its self-contained view under the same
 * rule the protocol serves them by (serve-page-request.ts): only files inside
 * the directory that holds the page, checked lexically and again after
 * resolving symlinks. A reference that breaks the rule, or names a file that
 * is not there, fails the build — a view that silently lost an image would be
 * a broken page for everyone but the author.
 *
 * Remote `http(s)` references are left alone and collected as warnings: the
 * view's frame blocks them (`img-src`/`connect-src`), and the agent is told.
 */

export type AssetReference =
  | { kind: 'ignored' }
  | { kind: 'remote'; url: string }
  | { kind: 'local'; ref: string };

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

export function classifyReference(raw: string): AssetReference {
  const ref = raw.trim();
  if (ref === '' || ref.startsWith('#')) return { kind: 'ignored' };
  if (/^https?:/i.test(ref) || ref.startsWith('//')) return { kind: 'remote', url: ref };
  // data:, blob:, mailto:, javascript: … carry or name nothing on disk.
  if (SCHEME.test(ref)) return { kind: 'ignored' };
  return { kind: 'local', ref };
}

function mimeTypeFor(path: string): string {
  return contentTypeForPath(path).split(';')[0]!.trim();
}

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"'\s][^)\s]*))\s*\)/g;

export interface PageAssetReader {
  /** Every remote reference met so far, once each, in document order. */
  readonly warnings: string[];
  noteRemote(url: string): void;
  /** A local asset's text; `fromDir` is the directory of the file that names it. */
  readText(ref: string, fromDir: string): { text: string; path: string };
  /** A local asset as a `data:` URI. */
  readDataUri(ref: string, fromDir: string): string;
  /** A stylesheet with every local `url()` inlined and every remote one reported. */
  inlineCssUrls(css: string, fromDir: string): string;
}

export function createPageAssetReader(pageFilePath: string): PageAssetReader {
  const pageDir = normalize(dirname(pageFilePath));
  const warnings: string[] = [];
  const seenRemote = new Set<string>();

  function resolveLocal(ref: string, fromDir: string): string {
    const withoutSuffix = ref.replace(/[?#].*$/, '');
    let decoded: string;
    try {
      decoded = decodeURIComponent(withoutSuffix);
    } catch {
      throw new Error(`The page references a malformed asset path: "${ref}"`);
    }
    if (/^[A-Za-z]:/.test(decoded) || decoded.startsWith('\\')) {
      throw new Error(`Asset "${ref}" is outside the page's directory; move it next to the page.`);
    }
    // A root-relative path is served from the page's directory, so it resolves there.
    const resolved = decoded.startsWith('/')
      ? normalize(join(pageDir, decoded.replace(/^\/+/, '')))
      : normalize(join(fromDir, decoded));
    if (resolved === pageDir || !isPathInside(pageDir, resolved)) {
      throw new Error(`Asset "${ref}" is outside the page's directory; move it next to the page.`);
    }
    const stat = statSync(resolved, { throwIfNoEntry: false });
    if (!stat?.isFile()) {
      throw new Error(
        `The page references "${ref}", but ${relative(pageDir, resolved)} does not exist next to it.`
      );
    }
    if (!isRealPathInside(pageDir, resolved)) {
      throw new Error(
        `Asset "${ref}" links outside the page's directory; copy the file in instead.`
      );
    }
    return resolved;
  }

  const reader: PageAssetReader = {
    warnings,
    noteRemote(url) {
      if (seenRemote.has(url)) return;
      seenRemote.add(url);
      warnings.push(
        `${url} is a remote reference; the shared view blocks it, so teammates will not see it. Save it next to the page and reference it relatively.`
      );
    },
    readText(ref, fromDir) {
      const path = resolveLocal(ref, fromDir);
      return { text: readFileSync(path, 'utf-8'), path };
    },
    readDataUri(ref, fromDir) {
      const path = resolveLocal(ref, fromDir);
      return `data:${mimeTypeFor(path)};base64,${readFileSync(path).toString('base64')}`;
    },
    inlineCssUrls(css, fromDir) {
      return css.replace(CSS_URL, (whole, doubleQuoted, singleQuoted, bare) => {
        const target = classifyReference(
          (doubleQuoted as string | undefined) ??
            (singleQuoted as string | undefined) ??
            (bare as string)
        );
        if (target.kind === 'remote') {
          reader.noteRemote(target.url);
          return whole;
        }
        if (target.kind === 'ignored') return whole;
        return `url("${reader.readDataUri(target.ref, fromDir)}")`;
      });
    },
  };
  return reader;
}
