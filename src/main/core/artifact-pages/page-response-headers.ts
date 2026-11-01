import { extname } from 'node:path';

/** `chord-artifact://<pageId>/<file>` — one origin per page. */
export const ARTIFACT_PAGE_SCHEME = 'chord-artifact';

export function artifactPageOrigin(pageId: string): string {
  return `${ARTIFACT_PAGE_SCHEME}://${pageId}`;
}

/**
 * The frame CSP (plan 2026-09-23 P1a step 2, tightened to the page's own
 * origin). `sandbox allow-scripts` without `allow-same-origin` gives the
 * document an opaque origin, so even though the host also sets `sandbox` on
 * the iframe element, a page that is ever opened outside that iframe stays
 * sandboxed. `'self'` means nothing to an opaque document, so scripts, styles,
 * images and fonts are pinned to the concrete `chord-artifact://<pageId>`
 * origin — page A cannot pull page B's bundle or authored assets in as a
 * subresource. `connect-src 'none'` blocks fetch/XHR/WebSocket, and
 * `form-action` / `base-uri` are closed so a page cannot redirect a submission
 * or rebase its relative URLs onto another origin.
 *
 * Responses that belong to no page (unknown host, bad method) carry the same
 * policy with every source closed: a plain-text error never executes anything.
 */
export function artifactPageCsp(pageId: string | null): string {
  const origin = pageId ? artifactPageOrigin(pageId) : null;
  const code = origin ? `'unsafe-inline' ${origin}` : "'none'";
  const asset = (schemes: string) => (origin ? `${schemes} ${origin}` : "'none'");
  return [
    'sandbox allow-scripts',
    "default-src 'none'",
    `script-src ${code}`,
    `style-src ${code}`,
    `img-src ${asset('data: blob:')}`,
    `font-src ${asset('data:')}`,
    "connect-src 'none'",
    "form-action 'none'",
    "base-uri 'none'",
  ].join('; ');
}

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
};

/**
 * Unknown extensions are served as opaque bytes. With `nosniff` the browser
 * will not promote them to script or style, so an odd asset degrades to a
 * download-shaped response rather than executable content.
 */
export function contentTypeForPath(filePath: string): string {
  return CONTENT_TYPES[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

/** Every response — bodies, errors, 404s — carries the same isolation headers. */
export function artifactPageHeaders(contentType: string, pageId: string | null): Headers {
  return new Headers({
    'Content-Type': contentType,
    'Content-Security-Policy': artifactPageCsp(pageId),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Cache-Control': 'no-store',
  });
}

export function artifactPageResponse(
  body: BodyInit | null,
  contentType: string,
  pageId: string | null,
  status = 200
): Response {
  return new Response(body, { status, headers: artifactPageHeaders(contentType, pageId) });
}

export function artifactPageError(
  status: number,
  message: string,
  pageId: string | null = null
): Response {
  return artifactPageResponse(message, 'text/plain; charset=utf-8', pageId, status);
}
